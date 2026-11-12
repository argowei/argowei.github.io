import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { Alert, AlertPage, AlertsStatus } from '../core/alerts.models';
import { Device } from '../core/device.models';
import { EventPage } from '../core/event.models';
import { Group } from '../core/group.models';
import { Scan, ScanComparison, ScanWithPorts } from '../core/scan.models';
import { CronPreview, ScanSchedule } from '../core/schedule.models';
import { createDemoBackend } from './demo-backend';
import { createDemoState } from './demo-data';

const NOW = Date.parse('2026-06-01T12:00:00Z');

function client(): HttpClient {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withInterceptors([createDemoBackend(NOW)]))],
  });
  return TestBed.inject(HttpClient);
}

const get = <T>(http: HttpClient, url: string) => firstValueFrom(http.get<T>(url));

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    return (error as HttpErrorResponse).status;
  }
  throw new Error('expected the request to fail');
}

describe('demo data', () => {
  it('uses only documentation addresses and locally administered MACs', () => {
    const { devices } = createDemoState(NOW);

    expect(devices).toHaveLength(5);
    for (const device of devices) {
      expect(device.locally_administered_mac).toBe(true);
      expect(device.vendor).toBeNull();
      // Bit 1 of the first octet marks a locally administered address.
      expect(parseInt(device.mac_address.slice(0, 2), 16) & 0b10).toBe(0b10);
      for (const address of device.addresses) {
        expect(address.ip_address).toMatch(/^192\.0\.2\.\d+$/);
      }
    }
  });

  it('puts every device in an existing group and counts them', () => {
    const { devices, groups } = createDemoState(NOW);

    for (const device of devices) {
      expect(groups.map((g) => g.id)).toContain(device.group_id);
    }
    expect(groups.reduce((sum, g) => sum + g.device_count, 0)).toBe(devices.length);
  });
});

describe('demo backend', () => {
  it('answers the session probe as a signed-in demo user', async () => {
    const http = client();

    expect(await get(http, '/api/auth/status')).toEqual({ setup_required: false });
    expect(await get(http, '/api/auth/me')).toEqual({ username: 'demo' });
    expect(await get(http, '/api/health')).toEqual({ status: 'ok', database: 'ok' });
  });

  it('requires a new login after signing out, and accepts any credentials', async () => {
    const http = client();

    await firstValueFrom(http.post('/api/auth/logout', null));
    expect(await statusOf(get(http, '/api/auth/me'))).toBe(401);
    expect(await statusOf(get(http, '/api/devices'))).toBe(401);
    expect(await statusOf(get(http, '/api/events'))).toBe(401);
    expect(await statusOf(get(http, '/api/devices/2/scans'))).toBe(401);
    expect(await statusOf(get(http, '/api/scan-schedules'))).toBe(401);

    await firstValueFrom(http.post('/api/auth/login', { username: 'x', password: 'y' }));
    expect(await get<Device[]>(http, '/api/devices')).toHaveLength(5);
  });

  it('lists and fetches devices', async () => {
    const http = client();

    const devices = await get<Device[]>(http, '/api/devices');
    expect(devices.map((d) => d.display_name)).toContain('Build server');

    const one = await get<Device>(http, `/api/devices/${devices[0].id}`);
    expect(one.id).toBe(devices[0].id);
    expect(await statusOf(get(http, '/api/devices/999'))).toBe(404);
  });

  it('applies a patch and derives the dependent fields', async () => {
    const http = client();
    const [first] = await get<Device[]>(http, '/api/devices');

    const patched = await firstValueFrom(
      http.patch<Device>(`/api/devices/${first.id}`, {
        label: '  Renamed  ',
        trust_level: 'suspicious',
        type_override: 'printer',
        group_id: 4,
      }),
    );

    expect(patched.display_name).toBe('Renamed');
    expect(patched.trust_level).toBe('suspicious');
    expect(patched.device_type).toBe('printer');
    expect(patched.type_source).toBe('manual');
    expect(patched.group).toEqual({ id: 4, name: 'Guest' });

    const cleared = await firstValueFrom(
      http.patch<Device>(`/api/devices/${first.id}`, { label: null, type_override: null }),
    );
    expect(cleared.display_name).toBe(first.name);
    expect(cleared.device_type).toBe(first.inferred.device_type);
    expect(cleared.type_source).toBe('inferred');
  });

  it('shows a renamed device by its current name in alerts', async () => {
    const http = client();
    await firstValueFrom(http.patch('/api/devices/4', { label: 'Renamed printer' }));

    const alerts = await get<AlertPage>(http, '/api/alerts?status=active');
    expect(alerts.items.find((alert) => alert.device?.id === 4)?.device?.display_name).toBe(
      'Renamed printer',
    );
  });

  it('rejects invalid patches and leaves the device unchanged', async () => {
    const http = client();
    const [first] = await get<Device[]>(http, '/api/devices');

    for (const body of [
      { trust_level: 'godmode' },
      { type_override: 'toaster' },
      { group_id: 99 },
    ]) {
      expect(await statusOf(firstValueFrom(http.patch(`/api/devices/${first.id}`, body)))).toBe(
        400,
      );
    }
    expect(await get<Device>(http, `/api/devices/${first.id}`)).toEqual(first);
  });

  it('keeps group counts in step with moved devices', async () => {
    const http = client();
    const [first] = await get<Device[]>(http, '/api/devices');
    const before = await get<Group[]>(http, '/api/groups');

    await firstValueFrom(http.patch(`/api/devices/${first.id}`, { group_id: 8 }));

    const after = await get<Group[]>(http, '/api/groups');
    const count = (groups: Group[], id: number) => groups.find((g) => g.id === id)?.device_count;
    expect(count(after, 8)).toBe(count(before, 8)! + 1);
    expect(count(after, first.group_id)).toBe(count(before, first.group_id)! - 1);
  });

  it('does not hand out its internal state', async () => {
    const http = client();

    const devices = await get<Device[]>(http, '/api/devices');
    devices[0].notes = 'tampered';

    expect((await get<Device[]>(http, '/api/devices'))[0].notes).not.toBe('tampered');
  });

  it('moves alerts through acknowledge and resolve', async () => {
    const http = client();

    const active = await get<AlertPage>(http, '/api/alerts?status=active');
    expect(active.items.map((a) => a.status).sort()).toEqual(['acknowledged', 'open']);
    expect(active.next_before).toBeNull();
    const open = active.items.find((a) => a.status === 'open') as Alert;

    const acknowledged = await firstValueFrom(
      http.post<Alert>(`/api/alerts/${open.id}/acknowledge`, null),
    );
    expect(acknowledged.status).toBe('acknowledged');
    expect(acknowledged.acknowledged_by).toBe('demo');

    const resolved = await firstValueFrom(http.post<Alert>(`/api/alerts/${open.id}/resolve`, null));
    expect(resolved.status).toBe('resolved');

    const status = await get<AlertsStatus>(http, '/api/alerts/status');
    expect(status).toMatchObject({ open: 0, acknowledged: 1 });
    const done = await get<AlertPage>(http, '/api/alerts?status=resolved');
    expect(done.items.map((a) => a.id)).toContain(open.id);
    expect(await statusOf(firstValueFrom(http.post('/api/alerts/999/resolve', null)))).toBe(404);
  });

  it('serves the new timeline with filters and cursor paging', async () => {
    const http = client();
    const page = await get<EventPage>(http, '/api/events');
    expect(page.items.map((event) => event.id)).toEqual([5, 4, 3, 2, 1]);
    expect(
      (await get<EventPage>(http, '/api/events?device=2&type=scan.completed')).items,
    ).toHaveLength(2);
    expect(
      (await get<EventPage>(http, `/api/events?before=${page.items[2].cursor}`)).items.map(
        (event) => event.id,
      ),
    ).toEqual([2, 1]);
    expect(
      (await get<EventPage>(http, '/api/events?after=3')).items.map((event) => event.id),
    ).toEqual([5, 4]);
    expect(await statusOf(get(http, '/api/events?before=nope'))).toBe(400);
    expect(await get(http, '/api/events/types')).toContainEqual({
      type: 'port.opened',
      schema_version: 1,
      severity: 'warning',
    });
  });

  it('shows synthetic scan history, comparison and an immediate demo scan', async () => {
    const http = client();
    const history = await get<Scan[]>(http, '/api/devices/2/scans');
    expect(history.map((scan) => scan.id)).toEqual([2, 1]);
    expect((await get<ScanWithPorts>(http, '/api/scans/2')).ports.map((port) => port.port)).toEqual(
      [22, 80],
    );
    const comparison = await get<ScanComparison>(http, '/api/scans/2/diff?against=1');
    expect(comparison.diff.opened.map((port) => port.port)).toEqual([80]);

    const started = await firstValueFrom(
      http.post<Scan>('/api/devices/2/scans', { profile: 'service' }),
    );
    expect(started.status).toBe('completed');
    expect((await get<Scan[]>(http, '/api/devices/2/scans'))[0].id).toBe(started.id);
    expect((await get<EventPage>(http, '/api/events?after=5')).items[0].payload['scan_id']).toBe(
      started.id,
    );
    expect(await statusOf(get(http, '/api/scans/999'))).toBe(404);
  });

  it('previews and edits demo schedules without pretending to run them', async () => {
    const http = client();
    const preview = await get<CronPreview>(
      http,
      '/api/scan-schedules/preview?cron=0%203%20*%20*%20*',
    );
    expect(preview.upcoming).toHaveLength(3);
    expect(await statusOf(get(http, '/api/scan-schedules/preview?cron=*%20*%20*%20*%20*'))).toBe(
      422,
    );
    const schedule = await firstValueFrom(
      http.post<ScanSchedule>('/api/scan-schedules', {
        name: 'Router',
        cron: '30 4 * * *',
        profile: 'quick',
        target: { kind: 'device', id: 1 },
      }),
    );
    expect(schedule.target_name).toBe('Lab router');
    const renamed = await firstValueFrom(
      http.patch<ScanSchedule>(`/api/scan-schedules/${schedule.id}`, { name: 'Router check' }),
    );
    expect(renamed.next_run_at).toBe(schedule.next_run_at);
    const off = await firstValueFrom(
      http.patch<ScanSchedule>(`/api/scan-schedules/${schedule.id}`, { enabled: false }),
    );
    expect(off.next_run_at).toBeNull();
    expect(
      (await get<ScanSchedule[]>(http, '/api/scan-schedules')).find(
        (item) => item.id === schedule.id,
      )?.enabled,
    ).toBe(false);
    await firstValueFrom(http.delete(`/api/scan-schedules/${schedule.id}`));
    expect(
      (await get<ScanSchedule[]>(http, '/api/scan-schedules')).some(
        (item) => item.id === schedule.id,
      ),
    ).toBe(false);
  });

  it('answers unknown API paths with 404', async () => {
    expect(await statusOf(get(client(), '/api/nope'))).toBe(404);
  });
});

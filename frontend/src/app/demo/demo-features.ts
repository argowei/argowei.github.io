/** Synthetic timeline, port scans and schedules for the static dashboard. */
import { EventPage, EventTypeInfo, TimelineEvent } from '../core/event.models';
import {
  PortChange,
  Scan,
  ScanComparison,
  ScanPort,
  ScanProfile,
  ScanWithPorts,
  ServiceInfo,
} from '../core/scan.models';
import { CronPreview, ScanSchedule, ScheduleInput, ScheduleTarget } from '../core/schedule.models';
import { DEMO_USERNAME, DemoState } from './demo-data';

export class DemoFault extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const PAGE_SIZE = 50;

export function eventTypes(state: DemoState): EventTypeInfo[] {
  return [
    ...new Map(
      state.events.map((event) => [
        event.type,
        {
          type: event.type,
          schema_version: event.schema_version,
          severity: event.severity,
        },
      ]),
    ).values(),
  ];
}

export function listEvents(state: DemoState, query: URLSearchParams): EventPage {
  const before = cursor(query, 'before');
  const after = cursor(query, 'after');
  if (before !== null && after !== null) throw new DemoFault(400, 'use either before or after');
  const from = query.get('from');
  const to = query.get('to');
  const items = state.events
    .filter(
      (event) =>
        (!query.get('device') || event.device?.id === Number(query.get('device'))) &&
        (!query.get('type') || event.type === query.get('type')) &&
        (!query.get('severity') || event.severity === query.get('severity')) &&
        (!from || event.occurred_at >= from) &&
        (!to || event.occurred_at <= to) &&
        (before === null || event.id < before) &&
        (after === null || event.id > after),
    )
    .sort((a, b) => b.id - a.id);
  const more = items.length > PAGE_SIZE;
  const page = items.slice(0, PAGE_SIZE);
  return {
    items: page,
    next_before: more && after === null ? page.at(-1)!.cursor : null,
    truncated: more && after !== null,
  };
}

function cursor(query: URLSearchParams, name: string): number | null {
  const raw = query.get(name);
  if (!raw) return null;
  if (!/^[1-9]\d*$/.test(raw)) throw new DemoFault(400, `${name} is not a valid cursor`);
  return Number(raw);
}

export function recordEvent(
  state: DemoState,
  deviceId: number,
  type: string,
  severity: TimelineEvent['severity'],
  payload: Record<string, unknown>,
): void {
  const device = state.devices.find((item) => item.id === deviceId);
  if (!device) return;
  const id = Math.max(0, ...state.events.map((item) => item.id)) + 1;
  state.events.unshift({
    id,
    cursor: String(id),
    occurred_at: new Date().toISOString(),
    type,
    schema_version: 1,
    severity,
    device: {
      id: device.id,
      display_name: device.display_name,
      mac_address: device.mac_address,
      vendor: device.vendor,
    },
    payload,
  });
}

const summary = (scan: ScanWithPorts): Scan => ({
  id: scan.id,
  device_id: scan.device_id,
  target_ip: scan.target_ip,
  profile: scan.profile,
  status: scan.status,
  requested_by: scan.requested_by,
  schedule_id: scan.schedule_id,
  created_at: scan.created_at,
  started_at: scan.started_at,
  finished_at: scan.finished_at,
  error: scan.error,
  nmap_version: scan.nmap_version,
  open_ports: scan.open_ports,
});

export function scanHistory(state: DemoState, deviceId: number): Scan[] {
  if (!state.devices.some((device) => device.id === deviceId))
    throw new DemoFault(404, 'no such device');
  return state.scans
    .filter((scan) => scan.device_id === deviceId)
    .sort((a, b) => b.id - a.id)
    .map(summary);
}

export function scanResult(state: DemoState, id: number): ScanWithPorts {
  const scan = state.scans.find((item) => item.id === id);
  if (!scan) throw new DemoFault(404, 'no such scan');
  return scan;
}

export function startScan(state: DemoState, deviceId: number, profile: ScanProfile): Scan {
  const device = state.devices.find((item) => item.id === deviceId);
  if (!device) throw new DemoFault(404, 'no such device');
  if (!['quick', 'service', 'full'].includes(profile)) throw new DemoFault(400, 'invalid profile');
  const now = new Date().toISOString();
  const previous = state.scans.find((item) => item.device_id === deviceId);
  const ports = previous?.ports.map((port) => ({ ...port })) ?? [];
  const scan: ScanWithPorts = {
    id: Math.max(0, ...state.scans.map((item) => item.id)) + 1,
    device_id: deviceId,
    target_ip: device.addresses[0].ip_address,
    profile,
    status: 'completed',
    requested_by: DEMO_USERNAME,
    schedule_id: null,
    created_at: now,
    started_at: now,
    finished_at: now,
    error: null,
    nmap_version: 'demo',
    open_ports: ports.filter((port) => port.state === 'open').length,
    ports,
  };
  state.scans.unshift(scan);
  recordEvent(state, deviceId, 'scan.completed', 'info', {
    scan_id: scan.id,
    profile,
    target: scan.target_ip,
    open_ports: ports.filter((port) => port.state === 'open').map((port) => port.port),
    duration_secs: 0,
  });
  return summary(scan);
}

const service = (port: ScanPort): ServiceInfo => ({
  service: port.service,
  product: port.product,
  version: port.version,
});
const change = (port: ScanPort): PortChange => ({
  protocol: port.protocol,
  port: port.port,
  service: service(port),
});

export function compareScans(state: DemoState, id: number, against: number | null): ScanComparison {
  const scan = scanResult(state, id);
  const other =
    against === null
      ? state.scans.find((item) => item.device_id === scan.device_id && item.id < id)
      : scanResult(state, against);
  if (!other) throw new DemoFault(422, 'there is no earlier completed scan to compare with');
  if (other.id === scan.id || other.device_id !== scan.device_id) {
    throw new DemoFault(422, 'only two scans of the same device can be compared');
  }
  const [older, newer] = scan.id < other.id ? [scan, other] : [other, scan];
  const left = older.ports.filter((port) => port.state === 'open');
  const right = newer.ports.filter((port) => port.state === 'open');
  const key = (port: ScanPort) => `${port.protocol}/${port.port}`;
  const old = new Map(left.map((port) => [key(port), port]));
  const recent = new Map(right.map((port) => [key(port), port]));
  const comparable = older.profile === newer.profile;
  const opened = right.filter((port) => !old.has(key(port))).map(change);
  const closed = left.filter((port) => !recent.has(key(port))).map(change);
  const changed = right.flatMap((port) => {
    const prior = old.get(key(port));
    return prior && comparable && JSON.stringify(service(prior)) !== JSON.stringify(service(port))
      ? [{ protocol: port.protocol, port: port.port, before: service(prior), after: service(port) }]
      : [];
  });
  return {
    older: summary(older),
    newer: summary(newer),
    diff: {
      opened: comparable ? opened : [],
      closed: comparable ? closed : [],
      changed,
      unchanged: comparable
        ? right.filter((port) => old.has(key(port))).length - changed.length
        : 0,
      not_comparable: comparable ? [] : [...opened, ...closed],
      profile_mismatch: !comparable,
      address_changed:
        older.target_ip === newer.target_ip ? null : [older.target_ip, newer.target_ip],
    },
  };
}

/** The demo previews common five-field schedules in UTC; it never runs them. */
export function previewCron(expression: string, now = Date.now()): CronPreview {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new DemoFault(422, 'expected five cron fields');
  const [minute, hour, day, month, weekday] = fields;
  if (day !== '*' || month !== '*' || weekday !== '*') {
    throw new DemoFault(422, 'the static demo previews daily schedules only');
  }
  const isMinute = /^\d{1,2}$/.test(minute);
  const isHour = /^\d{1,2}$/.test(hour);
  if (!isMinute || !isHour || Number(minute) > 59 || Number(hour) > 23) {
    throw new DemoFault(422, 'the static demo previews a fixed hour and minute only');
  }
  const next = new Date(now);
  next.setUTCHours(Number(hour), Number(minute), 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  return {
    description: `At ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} UTC`,
    upcoming: [0, 1, 2].map((days) => {
      const time = new Date(next);
      time.setUTCDate(time.getUTCDate() + days);
      return time.toISOString();
    }),
  };
}

function targetName(state: DemoState, target: ScheduleTarget): string | null {
  if (target.kind === 'all') return null;
  const name =
    target.kind === 'device'
      ? state.devices.find((device) => device.id === target.id)?.display_name
      : state.groups.find((group) => group.id === target.id)?.name;
  if (!name) throw new DemoFault(422, `no such ${target.kind} to scan`);
  return name;
}

export function saveSchedule(
  state: DemoState,
  input: Partial<ScheduleInput>,
  id: number | null,
): ScanSchedule {
  const old = id === null ? null : state.schedules.find((item) => item.id === id);
  if (id !== null && !old) throw new DemoFault(404, 'no such schedule');
  const name = (input.name ?? old?.name ?? '').trim();
  if (!name || name.length > 64) throw new DemoFault(400, 'name must have 1 to 64 characters');
  if (
    state.schedules.some((item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase())
  ) {
    throw new DemoFault(409, 'a schedule with this name already exists');
  }
  const cron = input.cron ?? old?.cron ?? '';
  const preview = previewCron(cron);
  const profile = input.profile ?? old?.profile;
  if (!profile || !['quick', 'service', 'full'].includes(profile))
    throw new DemoFault(400, 'invalid profile');
  const target = input.target ?? old?.target;
  if (!target) throw new DemoFault(422, 'missing target');
  const nameOfTarget = targetName(state, target);
  const enabled = input.enabled ?? old?.enabled ?? true;
  const keepPlan = Boolean(old?.enabled && enabled && input.cron === undefined);
  const upcoming = enabled ? (keepPlan ? old!.upcoming : preview.upcoming) : [];
  const next = enabled ? (keepPlan ? old!.next_run_at : preview.upcoming[0]) : null;
  const updated: ScanSchedule = {
    id: old?.id ?? Math.max(0, ...state.schedules.map((item) => item.id)) + 1,
    name,
    cron,
    description: preview.description,
    profile,
    target,
    target_name: nameOfTarget,
    enabled,
    created_by: old?.created_by ?? DEMO_USERNAME,
    created_at: old?.created_at ?? new Date().toISOString(),
    last_run_at: old?.last_run_at ?? null,
    next_run_at: next,
    upcoming,
  };
  if (old) Object.assign(old, updated);
  else state.schedules.push(updated);
  return updated;
}

export function deleteSchedule(state: DemoState, id: number): void {
  const index = state.schedules.findIndex((item) => item.id === id);
  if (index < 0) throw new DemoFault(404, 'no such schedule');
  state.schedules.splice(index, 1);
}

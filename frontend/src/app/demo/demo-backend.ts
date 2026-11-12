import {
  HttpErrorResponse,
  HttpEvent,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';

import { Alert } from '../core/alerts.models';
import { API_BASE } from '../core/api';
import { DEVICE_TYPES, Device, DevicePatch, TRUST_LEVELS } from '../core/device.models';
import { ScanProfile } from '../core/scan.models';
import { ScheduleInput } from '../core/schedule.models';
import {
  DEMO_USERNAME,
  DemoState,
  alertsStatus,
  createDemoState,
  refreshGroupCounts,
} from './demo-data';
import {
  DemoFault,
  compareScans,
  deleteSchedule,
  eventTypes,
  listEvents,
  previewCron,
  saveSchedule,
  scanHistory,
  scanResult,
  startScan,
} from './demo-features';

const PAGE_SIZE = 50;

/**
 * An in-memory stand-in for the API, used by the static demo. It answers the
 * calls the dashboard makes against synthetic data and keeps changes only for
 * the lifetime of the page: a reload starts over. It is not a model of the
 * real API's validation, only of its response shapes.
 */
export function createDemoBackend(now = Date.now()): HttpInterceptorFn {
  const state = createDemoState(now);
  let signedIn = true;

  return (request, next) => {
    const url = new URL(request.url, 'http://demo.invalid');
    if (url.pathname !== API_BASE && !url.pathname.startsWith(`${API_BASE}/`)) {
      return next(request);
    }

    const path = url.pathname.slice(API_BASE.length).replace(/\/$/, '');
    const route = (method: string, pattern: RegExp) =>
      request.method === method ? pattern.exec(path) : null;

    const session = (): Observable<HttpEvent<unknown>> =>
      signedIn ? ok({ username: DEMO_USERNAME }) : fail(401, 'not signed in');
    const authenticated = (reply: () => Observable<HttpEvent<unknown>>) =>
      signedIn ? reply() : fail(401, 'not signed in');
    const answer = (reply: () => unknown, status = 200) =>
      authenticated(() => {
        try {
          return ok(reply(), status);
        } catch (error) {
          if (error instanceof DemoFault) return fail(error.status, error.message, request);
          throw error;
        }
      });

    if (route('GET', /^$/)) return ok({ name: 'Argowei API (demo)', version: 'demo' });
    if (route('GET', /^\/health$/)) return ok({ status: 'ok', database: 'ok' });

    if (route('GET', /^\/auth\/status$/)) return ok({ setup_required: false });
    if (route('GET', /^\/auth\/me$/)) return session();
    if (route('POST', /^\/auth\/login$/)) {
      signedIn = true;
      return ok({ username: DEMO_USERNAME });
    }
    if (route('POST', /^\/auth\/logout$/)) {
      signedIn = false;
      return ok(null);
    }

    if (route('GET', /^\/devices$/)) return authenticated(() => ok(state.devices));

    let match: RegExpExecArray | null;
    if ((match = route('GET', /^\/devices\/(\d+)$/))) {
      return authenticated(() => withDevice(state, match![1], (device) => ok(device)));
    }
    if ((match = route('PATCH', /^\/devices\/(\d+)$/))) {
      return authenticated(() =>
        withDevice(state, match![1], (device) => patchDevice(state, device, request.body)),
      );
    }

    if (route('GET', /^\/groups$/)) return authenticated(() => ok(state.groups));

    if (route('GET', /^\/events\/types$/)) return answer(() => eventTypes(state));
    if (route('GET', /^\/events$/)) return answer(() => listEvents(state, url.searchParams));

    if ((match = route('GET', /^\/devices\/(\d+)\/scans$/))) {
      return answer(() => scanHistory(state, Number(match![1])));
    }
    if ((match = route('POST', /^\/devices\/(\d+)\/scans$/))) {
      return answer(
        () =>
          startScan(state, Number(match![1]), (request.body as { profile: ScanProfile }).profile),
        202,
      );
    }
    if ((match = route('GET', /^\/scans\/(\d+)$/))) {
      return answer(() => scanResult(state, Number(match![1])));
    }
    if ((match = route('GET', /^\/scans\/(\d+)\/diff$/))) {
      const against = url.searchParams.get('against');
      return answer(() =>
        compareScans(state, Number(match![1]), against === null ? null : Number(against)),
      );
    }
    if ((match = route('POST', /^\/scans\/(\d+)\/cancel$/))) {
      return answer(() => {
        scanResult(state, Number(match![1]));
        throw new DemoFault(409, 'this simulated scan has already completed');
      });
    }

    if (route('GET', /^\/scan-schedules\/preview$/)) {
      return answer(() => previewCron(url.searchParams.get('cron') ?? ''));
    }
    if (route('GET', /^\/scan-schedules$/)) {
      return answer(() => [...state.schedules].sort((a, b) => a.name.localeCompare(b.name)));
    }
    if (route('POST', /^\/scan-schedules$/)) {
      return answer(() => saveSchedule(state, request.body as ScheduleInput, null), 201);
    }
    if ((match = route('PATCH', /^\/scan-schedules\/(\d+)$/))) {
      return answer(() =>
        saveSchedule(state, request.body as Partial<ScheduleInput>, Number(match![1])),
      );
    }
    if ((match = route('DELETE', /^\/scan-schedules\/(\d+)$/))) {
      return answer(() => deleteSchedule(state, Number(match![1])), 204);
    }

    if (route('GET', /^\/alerts$/)) return authenticated(() => ok(listAlerts(state, url)));
    if (route('GET', /^\/alerts\/status$/)) return authenticated(() => ok(alertsStatus(state)));
    if ((match = route('POST', /^\/alerts\/(\d+)\/(acknowledge|resolve)$/))) {
      return authenticated(() => transitionAlert(state, Number(match![1]), match![2]));
    }

    return fail(404, 'not found', request);
  };
}

/** The interceptor the demo build installs. */
export const demoBackendInterceptor: HttpInterceptorFn = createDemoBackend();

function ok(body: unknown, status = 200): Observable<HttpEvent<unknown>> {
  return of(new HttpResponse({ status, body: structuredClone(body) }));
}

function fail(
  status: number,
  message: string,
  request?: HttpRequest<unknown>,
): Observable<HttpEvent<unknown>> {
  return throwError(
    () => new HttpErrorResponse({ status, error: { error: message }, url: request?.url }),
  );
}

function withDevice(
  state: DemoState,
  rawId: string,
  reply: (device: Device) => Observable<HttpEvent<unknown>>,
): Observable<HttpEvent<unknown>> {
  const device = state.devices.find((d) => d.id === Number(rawId));
  return device ? reply(device) : fail(404, 'device not found');
}

function patchDevice(
  state: DemoState,
  device: Device,
  body: unknown,
): Observable<HttpEvent<unknown>> {
  const patch = (body ?? {}) as DevicePatch;

  if (patch.trust_level !== undefined && !TRUST_LEVELS.includes(patch.trust_level)) {
    return fail(400, 'invalid trust level');
  }
  if (patch.type_override != null && !DEVICE_TYPES.includes(patch.type_override)) {
    return fail(400, 'invalid device type');
  }
  const group =
    patch.group_id === undefined ? undefined : state.groups.find((g) => g.id === patch.group_id);
  if (patch.group_id !== undefined && !group) {
    return fail(400, 'unknown group');
  }

  if (patch.label !== undefined) device.label = patch.label?.trim() || null;
  if (patch.notes !== undefined) device.notes = patch.notes;
  if (patch.trust_level !== undefined) device.trust_level = patch.trust_level;
  if (patch.type_override !== undefined) device.type_override = patch.type_override;
  if (group) {
    device.group_id = group.id;
    device.group = { id: group.id, name: group.name };
  }

  device.display_name = device.label ?? device.name;
  device.device_type = device.type_override ?? device.inferred.device_type;
  device.type_source = device.type_override ? 'manual' : 'inferred';
  for (const alert of state.alerts) {
    if (alert.device?.id === device.id) {
      alert.device.display_name = device.display_name;
    }
  }
  for (const event of state.events) {
    if (event.device?.id === device.id) event.device.display_name = device.display_name;
  }
  for (const schedule of state.schedules) {
    if (schedule.target?.kind === 'device' && schedule.target.id === device.id) {
      schedule.target_name = device.display_name;
    }
  }
  refreshGroupCounts(state);

  return ok(device);
}

function listAlerts(state: DemoState, url: URL) {
  const view = url.searchParams.get('status') ?? 'active';
  const before = Number(url.searchParams.get('before') ?? Infinity);
  const wanted = (alert: Alert) =>
    view === 'resolved' ? alert.status === 'resolved' : alert.status !== 'resolved';

  const matching = state.alerts
    .filter((alert) => wanted(alert) && alert.id < before)
    .sort((a, b) => b.id - a.id);
  const items = matching.slice(0, PAGE_SIZE);
  const more = matching.length > items.length;

  return { items, next_before: more ? items[items.length - 1].id : null };
}

function transitionAlert(
  state: DemoState,
  id: number,
  action: string,
): Observable<HttpEvent<unknown>> {
  const alert = state.alerts.find((a) => a.id === id);
  if (!alert) return fail(404, 'alert not found');

  const at = new Date().toISOString();
  if (action === 'acknowledge' && alert.status === 'open') {
    alert.status = 'acknowledged';
    alert.acknowledged_at = at;
    alert.acknowledged_by = DEMO_USERNAME;
  } else if (action === 'resolve' && alert.status !== 'resolved') {
    alert.status = 'resolved';
    alert.acknowledged_at ??= at;
    alert.acknowledged_by ??= DEMO_USERNAME;
    alert.resolved_at = at;
    alert.resolved_by = DEMO_USERNAME;
  }
  return ok(alert);
}

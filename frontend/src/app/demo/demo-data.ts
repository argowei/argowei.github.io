/**
 * Self-contained synthetic data for the static demo. RFC 5737 documentation
 * addresses and locally administered MACs represent no real network identity.
 */
import { Alert, AlertsStatus } from '../core/alerts.models';
import { Device, DeviceName, Evidence } from '../core/device.models';
import { TimelineEvent } from '../core/event.models';
import { Group } from '../core/group.models';
import { ScanSchedule } from '../core/schedule.models';
import { ScanWithPorts } from '../core/scan.models';

export interface DemoState {
  devices: Device[];
  groups: Group[];
  alerts: Alert[];
  events: TimelineEvent[];
  scans: ScanWithPorts[];
  schedules: ScanSchedule[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEMO_USERNAME = 'demo';
export const UNASSIGNED_GROUP_ID = 1;

const SYSTEM_GROUPS: [slug: string, name: string, description: string, defaults: object][] = [
  [
    'unassigned',
    'Unassigned',
    'Devices that have not been classified yet. New devices start here.',
    {},
  ],
  [
    'trusted',
    'Trusted',
    'Full LAN and internet access, no restrictions.',
    { internet: 'allow', lan: 'allow' },
  ],
  [
    'servers',
    'Servers',
    'Full access; regular hardening checks.',
    { internet: 'allow', lan: 'allow', hardening_checks: true },
  ],
  [
    'guest',
    'Guest',
    'Internet only, no LAN access, DNS filter active.',
    { internet: 'allow', lan: 'block', dns_filter: true },
  ],
  [
    'iot',
    'IoT',
    'Internet allowed, no access to trusted devices, trackers blocked.',
    { internet: 'allow', lan: 'block_trusted', tracker_block: true },
  ],
  [
    'kids',
    'Kids',
    'Internet on a schedule, category blocking active.',
    { internet: 'schedule', lan: 'allow', category_blocking: true },
  ],
  [
    'quarantine',
    'Quarantine',
    'No internet, no LAN, essential services only; released manually.',
    { internet: 'block', lan: 'block', essential_services_only: true, manual_release: true },
  ],
  ['blocked', 'Blocked', 'Completely blocked.', { internet: 'block', lan: 'block' }],
];

interface DeviceSeed {
  name: string;
  label: string;
  notes: string;
  online: boolean;
  trust: Device['trust_level'];
  type: Device['device_type'];
  confidence: number;
  evidence: Omit<Evidence, 'type'>[];
  group: number;
  firstSeenAgo: number;
  lastSeenAgo: number;
}

const GROUP = { trusted: 2, servers: 3, iot: 5 } as const;

const SEEDS: DeviceSeed[] = [
  {
    name: 'lab-router',
    label: 'Lab router',
    notes: 'Gateway of the lab network.',
    online: true,
    trust: 'trusted',
    type: 'router',
    confidence: 90,
    evidence: [{ kind: 'hostname', detail: 'Name contains "router"', weight: 90 }],
    group: GROUP.trusted,
    firstSeenAgo: 12 * DAY,
    lastSeenAgo: 2 * MINUTE,
  },
  {
    name: 'lab-server',
    label: 'Build server',
    notes: '',
    online: true,
    trust: 'trusted',
    type: 'server',
    confidence: 85,
    evidence: [
      { kind: 'hostname', detail: 'Name contains "server"', weight: 60 },
      { kind: 'port', detail: 'Port 22 (SSH) answers', weight: 25 },
    ],
    group: GROUP.servers,
    firstSeenAgo: 10 * DAY,
    lastSeenAgo: 4 * MINUTE,
  },
  {
    name: 'lab-laptop',
    label: 'Test laptop',
    notes: '',
    online: true,
    trust: 'normal',
    type: 'laptop',
    confidence: 75,
    evidence: [{ kind: 'hostname', detail: 'Name contains "laptop"', weight: 75 }],
    group: UNASSIGNED_GROUP_ID,
    firstSeenAgo: 7 * DAY,
    lastSeenAgo: 8 * MINUTE,
  },
  {
    name: 'lab-printer',
    label: 'Office printer',
    notes: 'Offline since the last power cycle.',
    online: false,
    trust: 'unknown',
    type: 'printer',
    confidence: 70,
    evidence: [{ kind: 'hostname', detail: 'Name contains "printer"', weight: 70 }],
    group: UNASSIGNED_GROUP_ID,
    firstSeenAgo: 5 * DAY,
    lastSeenAgo: 3 * HOUR,
  },
  {
    name: 'lab-sensor',
    label: 'Temperature sensor',
    notes: '',
    online: true,
    trust: 'restricted',
    type: 'iot',
    confidence: 65,
    evidence: [
      { kind: 'hostname', detail: 'Name contains "sensor"', weight: 40 },
      { kind: 'mdns', detail: 'Advertises _mqtt._tcp', weight: 25 },
    ],
    group: GROUP.iot,
    firstSeenAgo: 2 * DAY,
    lastSeenAgo: 6 * MINUTE,
  },
];

const iso = (now: number, ago: number) => new Date(now - ago).toISOString();

function seedDevice(seed: DeviceSeed, index: number, now: number, groups: Group[]): Device {
  const id = index + 1;
  const first = iso(now, seed.firstSeenAgo);
  const last = iso(now, seed.lastSeenAgo);
  const names: DeviceName[] = [{ source: 'dhcp', name: seed.name, last_seen: last }];
  const group = groups.find((g) => g.id === seed.group) as Group;

  return {
    id,
    name: seed.name,
    name_source: 'dhcp',
    label: seed.label,
    notes: seed.notes,
    display_name: seed.label,
    mac_address: `02:00:00:00:00:${String(id).padStart(2, '0')}`,
    vendor: null,
    locally_administered_mac: true,
    is_online: seed.online,
    trust_level: seed.trust,
    device_type: seed.type,
    type_source: 'inferred',
    type_override: null,
    inferred: {
      device_type: seed.type,
      confidence: seed.confidence,
      evidence: seed.evidence.map((item) => ({ ...item, type: seed.type })),
    },
    group_id: group.id,
    group: { id: group.id, name: group.name },
    first_seen: first,
    last_seen: last,
    addresses: [
      {
        id,
        device_id: id,
        ip_address: `192.0.2.${id}`,
        protocol: 'V4',
        source: 'Arp',
        first_seen: first,
        last_seen: last,
      },
    ],
    names,
  };
}

function newDeviceAlert(
  id: number,
  device: Device,
  createdAgo: number,
  now: number,
  state: Pick<
    Alert,
    'status' | 'acknowledged_at' | 'acknowledged_by' | 'resolved_at' | 'resolved_by'
  >,
): Alert {
  return {
    id,
    type: 'device.new',
    severity: 'warning',
    created_at: iso(now, createdAgo),
    ...state,
    device: {
      id: device.id,
      display_name: device.display_name,
      mac_address: device.mac_address,
      vendor: device.vendor,
    },
    payload: {
      mac: device.mac_address,
      vendor: device.vendor,
      interface: 'lab0',
      ip: device.addresses[0].ip_address,
      suggested_actions: [
        {
          action: 'trust',
          label: 'Trust',
          available: true,
          effect: 'Sets the trust level to trusted.',
        },
        {
          action: 'restrict',
          label: 'Restrict',
          available: true,
          effect: 'Sets the trust level to restricted.',
        },
        {
          action: 'block',
          label: 'Block',
          available: false,
          reason: 'Needs gateway or router integration, which is not set up yet.',
        },
        {
          action: 'quarantine',
          label: 'Quarantine',
          available: false,
          reason: 'Needs gateway or router integration, which is not set up yet.',
        },
      ],
    },
  };
}

/** A fresh demo inventory, with all times relative to `now`. */
export function createDemoState(now = Date.now()): DemoState {
  const groups: Group[] = SYSTEM_GROUPS.map(([slug, name, description, defaults], index) => ({
    id: index + 1,
    slug,
    name,
    description,
    is_system: true,
    defaults: defaults as Record<string, unknown>,
    device_count: 0,
    created_at: iso(now, 30 * DAY),
  }));

  const devices = SEEDS.map((seed, index) => seedDevice(seed, index, now, groups));
  const [, , laptop, printer, sensor] = devices;

  const alerts: Alert[] = [
    newDeviceAlert(3, printer, 5 * DAY, now, {
      status: 'open',
      acknowledged_at: null,
      acknowledged_by: null,
      resolved_at: null,
      resolved_by: null,
    }),
    newDeviceAlert(2, sensor, 2 * DAY, now, {
      status: 'acknowledged',
      acknowledged_at: iso(now, 2 * DAY - 20 * MINUTE),
      acknowledged_by: DEMO_USERNAME,
      resolved_at: null,
      resolved_by: null,
    }),
    newDeviceAlert(1, laptop, 7 * DAY, now, {
      status: 'resolved',
      acknowledged_at: iso(now, 7 * DAY - 5 * MINUTE),
      acknowledged_by: DEMO_USERNAME,
      resolved_at: iso(now, 7 * DAY - 10 * MINUTE),
      resolved_by: DEMO_USERNAME,
    }),
  ];

  const event = (
    id: number,
    device: Device,
    type: string,
    severity: TimelineEvent['severity'],
    ago: number,
    payload: Record<string, unknown>,
  ): TimelineEvent => ({
    id,
    cursor: String(id),
    occurred_at: iso(now, ago),
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
  const [, server] = devices;
  const events = [
    event(5, server, 'port.opened', 'warning', 20 * MINUTE, {
      scan_id: 2,
      previous_scan_id: 1,
      target: '192.0.2.2',
      protocol: 'tcp',
      port: 80,
      service: { service: 'http', product: 'nginx', version: '1.27' },
    }),
    event(4, server, 'scan.completed', 'info', 20 * MINUTE, {
      scan_id: 2,
      profile: 'service',
      target: '192.0.2.2',
      open_ports: [22, 80],
      duration_secs: 1.4,
    }),
    event(3, printer, 'device.offline', 'warning', 3 * HOUR, {
      missed_scans: 2,
      silent_for_secs: 3600,
    }),
    event(2, server, 'scan.completed', 'info', DAY, {
      scan_id: 1,
      profile: 'service',
      target: '192.0.2.2',
      open_ports: [22],
      duration_secs: 1.2,
    }),
    event(1, sensor, 'device.discovered', 'info', 2 * DAY, {
      ip: '192.0.2.5',
      interface: 'lab0',
      baseline: false,
    }),
  ];
  const ssh = {
    protocol: 'tcp',
    port: 22,
    state: 'open',
    reason: 'syn-ack',
    service: 'ssh',
    product: 'OpenSSH',
    version: '9.6',
    extra_info: null,
  };
  const scans: ScanWithPorts[] = [
    {
      id: 2,
      device_id: server.id,
      target_ip: '192.0.2.2',
      profile: 'service',
      status: 'completed',
      requested_by: 'demo',
      schedule_id: null,
      created_at: iso(now, 20 * MINUTE),
      started_at: iso(now, 20 * MINUTE),
      finished_at: iso(now, 20 * MINUTE - 2_000),
      error: null,
      nmap_version: 'demo',
      open_ports: 2,
      ports: [
        ssh,
        {
          protocol: 'tcp',
          port: 80,
          state: 'open',
          reason: 'syn-ack',
          service: 'http',
          product: 'nginx',
          version: '1.27',
          extra_info: null,
        },
      ],
    },
    {
      id: 1,
      device_id: server.id,
      target_ip: '192.0.2.2',
      profile: 'service',
      status: 'completed',
      requested_by: 'demo',
      schedule_id: null,
      created_at: iso(now, DAY),
      started_at: iso(now, DAY),
      finished_at: iso(now, DAY - 2_000),
      error: null,
      nmap_version: 'demo',
      open_ports: 1,
      ports: [ssh],
    },
  ];
  const nextAtThree = new Date(now);
  nextAtThree.setUTCHours(3, 0, 0, 0);
  if (nextAtThree.getTime() <= now) nextAtThree.setUTCDate(nextAtThree.getUTCDate() + 1);
  const schedules: ScanSchedule[] = [
    {
      id: 1,
      name: 'Nightly build server',
      cron: '0 3 * * *',
      description: 'At 03:00 UTC',
      profile: 'service',
      target: { kind: 'device', id: server.id },
      target_name: server.display_name,
      enabled: true,
      created_by: DEMO_USERNAME,
      created_at: iso(now, DAY),
      last_run_at: iso(now, DAY),
      next_run_at: nextAtThree.toISOString(),
      upcoming: [0, 1, 2].map((days) => new Date(nextAtThree.getTime() + days * DAY).toISOString()),
    },
  ];

  const state = { devices, groups, alerts, events, scans, schedules };
  refreshGroupCounts(state);
  return state;
}

/** Keeps each group's `device_count` in step with the devices in it. */
export function refreshGroupCounts(state: DemoState): void {
  for (const group of state.groups) {
    group.device_count = state.devices.filter((device) => device.group_id === group.id).length;
  }
}

export function alertsStatus(state: DemoState): AlertsStatus {
  const count = (status: Alert['status']) => state.alerts.filter((a) => a.status === status).length;
  return {
    open: count('open'),
    acknowledged: count('acknowledged'),
    baseline: { state: 'done', window_secs: 0, ends_at: null },
  };
}

# 1. No adapter in front of Steam's internals

Date: 2026-10-24 · Status: accepted

## Context

The plugin touches five unsupported parts of Steam: `SteamClient.System.Audio`,
the audio store found through webpack (for device labels), `NotificationStore`
(to replace toasts), `SteamClient.Input` (the button combo), and
`RegisterForDeviceAdded/Removed`. Any Steam update can change them.

An architecture review on 2026-10-24 considered putting all five behind one
Steam adapter, with a fake adapter for tests.

## Decision

No adapter. The rules that need tests live in `src/outputs.ts` and
`src/shortcut.ts`, which take plain data (a `GetDevices()` snapshot, button
events) and import nothing from Steam or Decky. Tests feed them recorded
snapshots and button sequences, so no fake Steam is needed. With only one
real adapter, the seam would be hypothetical.

The Steam calls stay as thin glue in `src/index.tsx`.

## Revisit when

A Steam update forces changes in more than one of the five touchpoints at the
same time, or a test needs to drive the glue itself.

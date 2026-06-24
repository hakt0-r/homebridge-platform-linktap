# homebridge-platform-linktap

A [Homebridge](https://homebridge.io) plugin for [LinkTap](https://www.link-tap.com) wireless water timers.

> **Note:** This is a fork of [hakt0-r/homebridge-platform-linktap](https://github.com/hakt0-r/homebridge-platform-linktap). All original functionality and credit belong to the original author; this work builds on that codebase to add Homebridge v2 compatibility, live status, alerts, flow metering, and schedule pause.

Each tap appears in HomeKit as an irrigation valve (or a plain switch if preferred), with battery level, connection status, watering state, fault alerts, water volume (G2/G2S), and schedule pause/resume.

## Features

- Start/stop watering (instant mode) with an adjustable duration
- Real stop command on turn-off, with handling for the API's 15-second rate limit
- Battery level and low-battery warning
- Connection status (online/offline)
- Live watering state (reflects watering started from the app, manual button, or schedules)
- Combined fault alert (water cut, clog, valve failure, fallen device, abnormal flow, freeze)
- Water volume per cycle for G2/G2S flow-meter models (visible in Eve / Controller for HomeKit)
- Pause and resume scheduled watering plans, with automatic detection of the active mode
- Choice of accessory type: irrigation valve (default) or legacy on/off switch
- Configurable poll interval and optional quiet logging

## Installation

```bash
npm install -g homebridge-platform-linktap
```

## Configuration

Add the following to the `platforms` section of your Homebridge `config.json`, or use the Homebridge UI settings form:

```json
{
  "platform": "LinkTapPlatform",
  "username": "your_linktap_username",
  "apiKey": "your_api_key",
  "gatewayId": "your_gateway_id",
  "pollInterval": 5,
  "verboseStatusLog": true,
  "taps": [
    {
      "name": "Garden Tap",
      "location": "Back garden",
      "taplinkerId": "your_taplinker_id",
      "duration": 10,
      "autoBack": true,
      "useValve": true,
      "pauseHours": 24,
      "scheduleMode": "sevenDay"
    }
  ]
}
```

### Platform fields

| Field | Required | Description |
|-------|----------|-------------|
| `username` | Yes | Your LinkTap account username |
| `apiKey` | Yes | Your API key from https://www.link-tap.com/#!/api-for-developers |
| `gatewayId` | Yes | Your gateway's first 16-digit ID (no dashes) |
| `pollInterval` | No | Status refresh in minutes. Minimum 5 (API limit). 0 disables polling. Default 5 |
| `verboseStatusLog` | No | Show the routine per-poll status line in the main log. Set false to send it to the debug log only. Default true |

### Tap fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Friendly name shown in HomeKit |
| `location` | No | Optional location label |
| `taplinkerId` | Yes | Your taplinker's first 16-digit ID (no dashes) |
| `duration` | Yes | Watering duration in minutes (1 to 1439) |
| `autoBack` | No | Auto-revert to the previous mode after watering. Default true |
| `useValve` | No | Expose the tap as an irrigation valve (adds Active/InUse and flow sensing). Set false for a legacy on/off switch. Default true |
| `pauseHours` | No | How long the 'Pause Schedule' switch pauses scheduled watering (1 to 240, or -1 for indefinite). Default 24 |
| `scheduleMode` | No | Watering plan type used to resume the schedule: `sevenDay`, `interval`, `oddEven`, `month`, or `calendar`. Default `sevenDay` |

## Notes

- The LinkTap API rate-limits control calls to one per 15 seconds and status polling to once per 5 minutes, so status (battery, signal, watering, alerts, volume) can take a few minutes to update.
- Resume re-activates the watering plan that is live at the moment of resume, since the API has no standalone "resume" call.
- Pause state and mode changes made in the LinkTap app are not currently reflected back in HomeKit, as the device status response does not include a pause-state field.
- The default valve model adds live flow sensing. If you switch between valve and switch (the `useValve` option), remove and re-add the accessory in the Home app once.

## Credits

Credit goes to
- michaelfro for his work on [homebridge-delayed-switches](https://github.com/grover/homebridge-delayed-switches) that this is work is based on.
- [NorthernMan54](https://github.com/NorthernMan54) for helping me out and getting me across the line. Cheers mate!

## License

Published under the MIT License.

# homebridge-platform-linktap-v2

A maintained fork of the LinkTap Homebridge plugin, updated for **Homebridge v2** and modern HAP-nodejs, with security and reliability fixes.

> **Note:** This work is based on / forked from [hakt0-r/homebridge-platform-linktap](https://github.com/hakt0-r/homebridge-platform-linktap). All original functionality and credit belong to the original author; this fork builds on that codebase to add Homebridge v2 compatibility and related fixes.

## Why this fork exists

The original plugin fails to start on Homebridge v2 with errors like:

```
TypeError: Class constructor Characteristic cannot be invoked without 'new'
TypeError: Cannot read properties of undefined (reading 'INT')
```

This fork resolves those, removes a deprecated dependency, and fixes several bugs. The same changes have been submitted upstream as a pull request; this fork exists so the fix can be installed without waiting on the original repo.

## Installation

### 1. Uninstall the old plugin (if installed)

```bash
npm uninstall -g homebridge-platform-linktap
```

### 2. Install this version from GitHub

```bash
npm install -g https://github.com/phbuilds/homebridge-platform-linktap-v2
```

Or, if installing into a standard Homebridge instance:

```bash
npm install --prefix /var/lib/homebridge https://github.com/phbuilds/homebridge-platform-linktap-v2
```

## Configuration

Add the following to the `platforms` section of your Homebridge `config.json`:

```json
{
  "platform": "LinkTapPlatform",
  "username": "your_linktap_username",
  "apiKey": "your_api_key",
  "gatewayId": "your_gateway_id",
  "taps": [
    {
      "name": "Garden Tap",
      "location": "Back garden",
      "taplinkerId": "your_taplinker_id",
      "duration": 10,
      "autoBack": true
    }
  ]
}
```

### Config fields

| Field | Required | Description |
|-------|----------|-------------|
| `username` | Yes | Your LinkTap account username |
| `apiKey` | Yes | Your API key from https://www.link-tap.com/#!/api-for-developers |
| `gatewayId` | Yes | Your gateway's first 16-digit ID (no dashes) |
| `name` | Yes | Friendly name for the tap |
| `location` | No | Friendly location label |
| `taplinkerId` | Yes | Your taplinker's first 16-digit ID (no dashes) |
| `duration` | Yes | Watering duration in minutes (1 to 1439) |
| `autoBack` | No | Auto-revert to the previous mode after watering. Defaults to `true` |

## Behaviour notes

- **Turning off:** switching a tap off in HomeKit sends a real stop command to LinkTap (it no longer just clears a local timer).
- **Rate limiting:** the LinkTap API enforces a minimum 15-second interval between calls. If you turn a tap off shortly after turning it on, the off command is automatically deferred until that window clears, and is cancelled if you turn the tap back on in the meantime.
- **Auto-off:** with `autoBack` enabled, the LinkTap device stops watering on its own when the duration elapses; HomeKit state is updated to match.

## Changelog

### 1.3.0
- Removed the deprecated `request` dependency in favour of Node's built-in `https` module
- Pinned `debug` to `^4.3.4`; corrected `engines` to realistic minimums (Node 18+, Homebridge 1.6+)

### 1.2.0
- Added a real turn-off command with a 15-second API rate-limit guard

### 1.1.0
- Stopped logging the API key
- Fixed `autoBack` so `false` is respected
- Fixed a double-callback crash on network errors
- Use the real `taplinkerId` as the device serial number
- Added config validation for a missing `taps` array

### 1.0.0
- Homebridge v2 compatibility: ES6 `Characteristic` class and string-based characteristic props

## Credits

- Original plugin by [hakt0-r](https://github.com/hakt0-r/homebridge-platform-linktap)
- Based on [homebridge-delayed-switches](https://github.com/grover/homebridge-delayed-switches) by grover

## License

MIT

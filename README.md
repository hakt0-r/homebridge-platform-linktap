# homebridge-platform-linktap 

[![npm package](https://nodei.co/npm/homebridge-platform-linktap.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/homebridge-platform-linktap/)

[![NPM Version](https://img.shields.io/npm/v/homebridge-platform-linktap.svg)](https://www.npmjs.com/package/homebridge-platform-linktap)
[![Dependency Status](https://www.versioneye.com/user/projects/5a786fed0fb24f1f133fae07/badge.svg?style=flat-square)](https://www.versioneye.com/user/projects/5a786fed0fb24f1f133fae07)
[![Slack Channel](https://img.shields.io/badge/slack-platform--linktap-brightgreen.svg)](https://homebridgeteam.slack.com/messages/C93QDKXSP/)


LinkTap Platform Plugin for the [Homebridge](https://github.com/nfarina/homebridge) project.

# Note - seriously WIP

This package is currently being developed and is a WORK IN PROGRESS. Its currently in the ALPHA stage. 

## LinkTap

[LinkTap] (https://www.link-tap.com) is a wireless tap that is controlled by the LinkTap's wireless bridge.
There is a published LinkTap [API](https://www.link-tap.com/#!/api-for-developers). 

# Installation

1. Install homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g homebridge-platform-linktap`
3. Update your configuration file. See the sample below.

# Updating

npm update -g homebridge-platform-linktap

# Configuration

Configuration sample:

 ```javascript
// this is an example please do not copy/paste.

"platforms":[
    {
        "platform": "LinkTapPlatform",
        "username": "test",				//Required. String type. Your LinkTap account's username
        "apiKey": "a6f1223d1fe191f8ec55662d1eb45720'",	//Required. String type. Your API key
        "gatewayId": "3F7A23FE004B1200",		//Required. String type. Your LinkTap Gateway's first 16-digits/letters ID, case insensitive, no dash symbol
        "taps": [
            {
                "name": "lawn",				//Required. LinkTap name friendly name.
                "location": "Front yard",		//Optional. friendly location name.
                "taplinkerId": "67ABCDEF004B1200",	//Required. String type. Your LinkTap Taplinker's first 16-digits/letters ID, case insensitive, no dash symbol
                "duration": 1				//Required. The watering duration (unit is minutes) 1..1439 minutes. Default 1 minute.
           }
	]
    }
]
```

# Known Issues

These are currently no known issues.

# Future updates

These are some of the planned future updates to this project
- Async Timer - Cause when the API call fails, we can cancel the timer and triger the switch-off process.
~~- Implicit OFF - currently the switch-OFF is a timer based switch-off without the actual API call to implicitly switch off the tap. I'd like when the user switches off via the HomeKit the system determines if there is time left on the watering duration and if so issue the API call to switch off the LinkTap.~~

## Down the road...

These can be implemented as and when the LinkTap APIs are implemented. Some (if not all) are event driven.
- Characteristic.Active 
- Characteristic.BatteryLevel
- Characteristic.InUse
- Characteristic.StatusLowBattery

# Credits

Credit goes to
- michaelfro for his work on [homebridge-delayed-switches](https://github.com/grover/homebridge-delayed-switches) that this is work is based on.
- [NorthernMan54](https://github.com/NorthernMan54) for helping me out and getting me across the line. Cheers mate! 

# License

Published under the MIT License.

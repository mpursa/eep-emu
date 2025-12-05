<h1>EEPROM emulation library decoder</h1>

## Install

First run

```bash
npm install eep-emu --save
```
then

```javascript
import { Emu_V850e2 } from 'eep-emu';

// Pass dataflash contents as argument, the decoding is done in the constructor.
let emuV850e2 = new Emu_V850e2(dataFlashBuffer);
// Once created you can access each eeprom id content with
let id1 = emuV850e2.eepData[idToAccess];
// To log an eeprom id to console you can call 
emuV850e2.logEepId(idToLog);


import { Emu_RH850 } from 'eep-emu';

// Pass dataflash and codeflash contents as argument, the decoding is done in the constructor.
// Also pass the eeprom library data table address r_eel_descriptor_t, to allow the program
// to find the eeprom id info.
let emuRH850 = new Emu_RH850(dataFlashBuffer, codeFlashBuffer, eelDataTableAddress);
// Once created you can access each eeprom id content with
let id1 = emuRH850.eepData[idToAccess];
// To log an eeprom id to console you can call 
emuRH850.logEepId(idToLog);
// Once the data has been modified you can obtain the recreated dataflash buffer by calling.
let dataflashBuffer = emuRH850.createDataFlashBuffer();
```

## Supported microcontrollers

- NEC v850e2
- NEC RH850

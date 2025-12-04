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
let emu = new Emu_V850e2(dataFlashBuffer)
// Once created you can access each eeprom id content with
let id1 = emu.eepData[1];
```

## Supported microcontrollers

- NEC v850e2
- NEC RH850

/**
 * MODULE IMPORTS
 */
import fs from 'fs';
import { Global, List } from './global';

/**
 * INTERNAL IMPORTS
 */

/**
 * GLOBALS
 */
export type EepData = {
	id: number;
	widx: number;
	widx_abs: number;
	length: number;
	data: number[];
	dataBuf: Buffer;
	addr: number;
};
export type DataFlashBlock = {
	id: number;
	isValid: boolean;
	eraseCount: number;
	rwp: number;
	buf: Buffer;
};
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Extendable class for importing common methods.
 */
export class NecEmulator {
	///////////////// PROPERTIES ///////////////////
	private _dfBuffer: Buffer;
	private _eepData: List<EepData> = {};
	private _blockData: List<DataFlashBlock> = {};
	private _nBlocks: number;
	private _blockSize: number;
	private _activeBlocks: number[] = [];

	///////////////// CONSTRUCTOR //////////////////

	public constructor(dfBuf: Buffer, blockSize: number) {
		this._dfBuffer = dfBuf;
		this._blockSize = blockSize;
		// Check valdity of block size.
		if (this._dfBuffer.length === 0 || this._dfBuffer.length % this._blockSize !== 0) {
			throw new RangeError(
				`Invalid dataflash Buffer size: must be multiple of given block size ${Global.toHexString(
					this._blockSize
				)}, received ${Global.toHexString(this._dfBuffer.length)}`
			);
		}

		this._nBlocks = this._dfBuffer.length / this._blockSize;
	}

	///////////////// GET / SET //////////////////////
	protected get dfBuffer(): Buffer {
		return this._dfBuffer;
	}

	public get eepData(): List<EepData> {
		return this._eepData;
	}

	protected get blockData(): List<DataFlashBlock> {
		return this._blockData;
	}

	protected get nBlocks(): number {
		return this._nBlocks;
	}

	protected get blockSize(): number {
		return this._blockSize;
	}

	protected get activeBlocks(): number[] {
		return this._activeBlocks;
	}

	protected set eepData(data: List<EepData>) {
		this._eepData = data;
	}

	protected set blockData(data: List<DataFlashBlock>) {
		this._blockData = data;
	}

	protected set activeBlocks(blocks: number[]) {
		this._activeBlocks = blocks;
	}
	///////////////// METHODS //////////////////////

	/**
	 * Log all eeprom data.
	 * If the argument is left undefined the log will go to the console.
	 *
	 * @param {string} [fileName] - File path to log to.
	 * @returns {void}
	 */
	public logEeprom(fileName?: string): void {
		let finalStr: string = ``;
		for (let key in this._eepData) {
			if (fileName) {
				finalStr = finalStr.concat(this.eepIdToStr(this._eepData[key]));
			} else {
				this.logEepId(this._eepData[key]);
			}
		}

		if (fileName) fs.writeFileSync(fileName, finalStr);
	}

	/**
	 * Find active blocks in file buffer, and order them from the oldest to newest using
	 * the erase counter.
	 *
	 * @returns {number[]} Ordered active block list.
	 */
	protected getActiveBlocksOrderedList(): number[] {
		let blocks: List<number[]> = {};
		let eraseCounts: number[] = [];
		let finalBlockOrder: number[] = [];

		// Iterate through the blocks to get validity status, erase counter and rwp.
		for (let i: number = 0; i < this.nBlocks; i++) {
			// If the block is not valid, we skip it.
			if (!this.blockData[i].isValid) {
				continue;
			}
			// If the erase counter has never been found before, add it to the found ones.
			if (!blocks[this.blockData[i].eraseCount]) {
				blocks[this.blockData[i].eraseCount] = [];
				eraseCounts.push(this.blockData[i].eraseCount);
			}
			// Keep track of this block erase counter for ordering later.
			blocks[this.blockData[i].eraseCount].push(i);
		}

		// Data has multiple blocks with different erase values, combine them.
		eraseCounts.sort((a, b) => a - b);
		eraseCounts.forEach((eraseNum: number) => {
			finalBlockOrder.push(...blocks[eraseNum].sort((a, b) => a - b));
		});

		return finalBlockOrder;
	}

	/**
	 * @param {EepData} eepId - Data to log.
	 * @returns {string} Eeprom data as a formatted string.
	 */
	private eepIdToStr(eepId: EepData): string {
		let str: string = `################## ID ${Global.toHexString(
			eepId.id,
			3
		)} ###################\n`;
		let times: number = Math.ceil(eepId.dataBuf.length / 16);
		let tmpBuf: Buffer = Buffer.alloc(0x10);
		let tmpDecrBuf: Buffer = Buffer.alloc(0x10);
		for (let i = 0; i < times; i++) {
			tmpBuf.fill(0);
			tmpDecrBuf.fill(0);
			if (eepId.dataBuf.length % 0x10 !== 0 && i === times - 1) {
				let finalL: number = eepId.dataBuf.length % 0x10;
				tmpBuf = Buffer.alloc(finalL);
			}
			eepId.dataBuf.copy(tmpBuf, 0, i * 0x10);
			str = str.concat(this.rowStr(tmpBuf));
		}
		str = str.concat('###############################################\n\n');

		return str;
	}

	/**
	 * @param {Buffer} buf - Data row to log.
	 * @param {Buffer} [decrBuf] - Decrypted data buffer.
	 * @returns {string} Fs data row of 0x10 bytes as a formatted string.
	 */
	private rowStr(buf: Buffer, decrBuf?: Buffer): string {
		if (buf.length > 0x10) {
			throw new RangeError(`Given buffer is bigger than 0x10 byte, cannot log`);
		}

		let bytePart: string = '';
		for (let i = 0; i < 0x10; i++) {
			if (buf[i] === undefined) {
				bytePart = bytePart.concat('  ');
			} else {
				bytePart = bytePart.concat(Global.toHexString(buf[i], 2, false));
			}
			bytePart = bytePart.concat(' ');
		}

		let asciiPart: string = '';
		for (let byte of buf) {
			asciiPart = asciiPart.concat(byte < 32 || byte > 127 ? '.' : String.fromCharCode(byte));
		}
		asciiPart = asciiPart.padEnd(16, ' ');

		if (!decrBuf) return `${bytePart}       ${asciiPart}\n`;

		let decrBytePart: string = '';
		for (let i = 0; i < 0x10; i++) {
			if (decrBuf[i] === undefined) {
				decrBytePart = decrBytePart.concat('  ');
			} else {
				decrBytePart = decrBytePart.concat(Global.toHexString(decrBuf[i], 2, false));
			}
			decrBytePart = decrBytePart.concat(' ');
		}

		let decrAsciiPart: string = '';
		for (let byte of decrBuf) {
			decrAsciiPart = decrAsciiPart.concat(
				byte < 32 || byte > 127 ? '.' : String.fromCharCode(byte)
			);
		}
		decrAsciiPart = decrAsciiPart.padEnd(16, ' ');

		return `${bytePart}       ${asciiPart}        ${decrBytePart}       ${decrAsciiPart}\n`;
	}

	/**
	 * Log given fs id to console.
	 *
	 * @param {EepData} eepId - Data to log.
	 * @returns {void}
	 */
	public logEepId(eepId: EepData): void {
		console.log(`################## ID ${Global.toHexString(eepId.id)} ####################`);
		let times: number = Math.ceil(eepId.dataBuf.length / 16);
		let tmpBuf: Buffer = Buffer.alloc(0x10);
		for (let i = 0; i < times; i++) {
			tmpBuf.fill(0);
			if (eepId.dataBuf.length % 0x10 !== 0 && i === times - 1) {
				let finalL: number = eepId.dataBuf.length % 0x10;
				tmpBuf = Buffer.alloc(finalL);
			}
			eepId.dataBuf.copy(tmpBuf, 0, i * 0x10);
			this.logByteRow(tmpBuf);
		}
		console.log(`###############################################`);
		console.log();

		return;
	}

	/**
	 * Log to console the data row of 0x10 bytes as a formatted string.
	 *
	 * @param {Buffer} buf - Data row to log.
	 * @returns {void}
	 */
	private logByteRow(buf: Buffer): void {
		if (buf.length > 0x10) {
			throw new RangeError(`Given buffer is bigger than 0x10 byte, cannot log`);
		}

		let bytePart: string = '';
		for (let i = 0; i < 0x10; i++) {
			if (buf[i] === undefined) {
				bytePart = bytePart.concat('  ');
			} else {
				bytePart = bytePart.concat(Global.toHexString(buf[i], 2, false));
			}
			bytePart = bytePart.concat(' ');
		}

		let asciiPart: string = '';
		for (let byte of buf) {
			asciiPart = asciiPart.concat(byte < 32 || byte > 127 ? '.' : String.fromCharCode(byte));
		}

		console.log(bytePart + '       ' + asciiPart);

		return;
	}
}

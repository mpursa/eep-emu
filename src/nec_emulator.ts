/**
 * MODULE IMPORTS
 */
import fs from 'fs';

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
export type List<T> = {
	[key: number]: T;
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
				`Invalid dataflash Buffer size: must be multiple of given block size ${this.toHexString(
					this._blockSize
				)}, received ${this.toHexString(this._dfBuffer.length)}`
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
		let str: string = `################## ID ${this.toHexString(
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
				bytePart = bytePart.concat(this.toHexString(buf[i], 2, false));
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
				decrBytePart = decrBytePart.concat(this.toHexString(decrBuf[i], 2, false));
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
		console.log(`################## ID ${this.toHexString(eepId.id)} ####################`);
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
				bytePart = bytePart.concat(this.toHexString(buf[i], 2, false));
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

	/**
	 * Hexadecimal string formatter.
	 *
	 * Examples:
	 * 10.toHexString() -> 0x0A
	 * 17.toHexString() -> 0x11
	 * 17.toHexString(3) -> 0x011
	 * 17.toHexString(2, false) -> 11
	 *
	 * @param {number} num - Number to format
	 * @param {number} [pad] - How many places minimum in the resulting string. Default 2.
	 * @param {boolean} [w0x] - Prepend 0x in the string or not. Default true.
	 * @returns {string} Number formatted in hexadecimal format.
	 */
	protected toHexString(num: number, pad: number = 2, w0x: boolean = true): string {
		return (w0x ? '0x' : '') + num.toString(16).padStart(pad, '0').toUpperCase();
	}

	/**
	 * @param {Buffer} num - Int32 or uint32 number to represent as 4byte word.
	 * @param {boolean} [lEndian] - Use little endian, default true.
	 * @returns {Buffer} Byte word as 4 byte buffer.
	 */
	protected int32ToWord(num: number, lEndian: boolean = true): Buffer {
		if (num < -2147483648 || num > 0xffffffff) {
			throw new RangeError(`Number ${num} is not int32`);
		}
		let word: Buffer = Buffer.alloc(4);
		if (lEndian) {
			word[0] = num & 0xff;
			word[1] = (num & 0xffff) >>> 8;
			word[2] = (num & 0xffffff) >>> 16;
			word[3] = num >>> 24;
		} else {
			word[3] = num & 0xff;
			word[2] = (num & 0xffff) >>> 8;
			word[1] = (num & 0xffffff) >>> 16;
			word[0] = num >>> 24;
		}

		return word;
	}

	/**
	 * When the given buffer is under the length of 4, it will be filled with 0
	 * at the most-significant byte addresses.
	 *
	 * @param {Buffer} buf - Byte buffer in which to search.
	 * @param {number} addr - Word address, default 0.
	 * @param {boolean} [lEndian] - Use little endian, default true.
	 * @returns {number} Unsigned int32 representation as number of single word.
	 */
	protected readUint32(buf: Buffer, addr: number = 0, lEndian: boolean = true): number {
		if (buf.length < 4) {
			let newBuf: Buffer = Buffer.from([0, 0, 0, 0]);
			buf.copy(newBuf, lEndian ? 0 : newBuf.length - buf.length);
			// Replace original parameter buffer with valid 4 byte one.
			buf = Buffer.from(newBuf);
		}
		if (buf.length < addr + 4) {
			throw new RangeError(`Cannot read word at addr ${addr}, buffer is of length ${buf.length}`);
		}
		let word: Buffer = buf.subarray(addr, addr + 4);
		let arr: Uint32Array;
		arr = lEndian
			? new Uint32Array([word[3] << 24, word[2] << 16, word[1] << 8, word[0]])
			: new Uint32Array([word[0] << 24, word[1] << 16, word[2] << 8, word[3]]);
		let result: number = 0;

		arr.forEach((num: number) => {
			result += num;
		});

		return result;
	}

	/**
	 * @param {Buffer} buf - Buffer providing the data.
	 * @param {number} start - Start index.
	 * @param {number} end - End index. INCLUSIVE
	 * @returns {number} 8 bit checksum of the Buffer section provided.
	 */
	protected checkSum8bit(buf: Buffer, start: number, end: number): number {
		let res: number = 0;
		for (let i = start; i <= end; i++) {
			res += buf[i];
		}

		return res & 0xff;
	}
}

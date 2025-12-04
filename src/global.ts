/**
 * IMPORT MODULES
 */

/**
 * INTERNAL IMPORTS
 */

/**
 * GLOBALS
 */
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
 * Abstract export for global scope functions.
 */
export abstract class Global {
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
	public static toHexString = function (num: number, pad: number = 2, w0x: boolean = true): string {
		return (w0x ? '0x' : '') + num.toString(16).padStart(pad, '0').toUpperCase();
	};

	/**
	 * @param {Buffer} num - Int32 or uint32 number to represent as 4byte word.
	 * @param {boolean} [lEndian] - Use little endian, default true.
	 * @returns {Buffer} Byte word as 4 byte buffer.
	 */
	public static int32ToWord(num: number, lEndian: boolean = true): Buffer {
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
	public static readUint32(buf: Buffer, addr: number = 0, lEndian: boolean = true): number {
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
	public static checkSum8bit(buf: Buffer, start: number, end: number): number {
		let res: number = 0;
		for (let i = start; i <= end; i++) {
			res += buf[i];
		}

		return res & 0xff;
	}
}

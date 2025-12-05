/**
 * INTERNAL IMPORTS
 */
import { DataFlashBlock, NecEmulator, List } from './nec_emulator';

/**
 * GLOBALS
 */
const BLOCK_SIZE: number = 0x1000;
const ACTIVE_FLAG: number = 0x55555555;
const REF_END_FLAG: number = 0xffffffff;
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Handler for EEPROM emulation functions.
 */
export class Emu_V850e2 extends NecEmulator {
	///////////////// CONSTRUCTOR //////////////////
	/**
	 * @param {Buffer} dfBuf - Dataflash content buffer.
	 */
	public constructor(dfBuf: Buffer) {
		super(dfBuf, BLOCK_SIZE);
		this.blockData = this.getBlocksData();
		this.activeBlocks = this.getActiveBlocksOrderedList();
		for (let i: number = 0; i < this.activeBlocks.length; i++) {
			this.populateBlockData(i);
		}
	}

	///////////////// METHODS //////////////////////
	/**
	 * Find active blocks in file buffer, and order them from the oldest to newest using
	 * the erase counter.
	 *
	 * @returns {List<DataFlashBlock>} Memory blocks required data.
	 */
	private getBlocksData(): List<DataFlashBlock> {
		let blocks: List<DataFlashBlock> = {};
		// rwp -> reference write pointer.
		let rwps: number[] = [];

		// Iterate through the blocks to get validity status, erase counter and rwp.
		for (let i: number = 0; i < this.nBlocks; i++) {
			let blockBuffer: Buffer = Buffer.alloc(this.blockSize);
			this.dfBuffer.copy(blockBuffer, 0, i * this.blockSize);
			blocks[i] = {
				id: i,
				isValid: this.isValidBlock(blockBuffer),
				eraseCount: this.readUint32(blockBuffer.subarray(0x28, 0x2b)),
				rwp: 0,
				buf: blockBuffer,
			};
			// If the block is not valid, we skip getting other info.
			if (!blocks[i].isValid) {
				continue;
			}
			// Add the rwp to the found ones.
			rwps.push(this.readUint32(blockBuffer.subarray(0x30, 0x33)) * 2);
		}

		// Give the rwp to the correct block, since the rwp for a block is written in the following one.
		// Keep in mind that the latest active block will NOT have a rwp because it is not finished writing.
		rwps.forEach((rwpAddr: number) => {
			let rwpBlock: number = Math.floor(rwpAddr / this.blockSize);
			blocks[rwpBlock].rwp = rwpAddr;
		});

		return blocks;
	}

	/**
	 * For the memory block to be active the words at address
	 * 0x10, 0x18 and 0x20 must be written with the active flag.
	 *
	 * @param {Buffer} blockBuffer - Memory block data.
	 * @returns {boolean} Given block is active in eeprom emulation.
	 */
	private isValidBlock(blockBuffer: Buffer): boolean {
		return (
			blockBuffer.length === this.blockSize &&
			ACTIVE_FLAG === this.readUint32(blockBuffer, 0x10) &&
			ACTIVE_FLAG === this.readUint32(blockBuffer, 0x18) &&
			ACTIVE_FLAG === this.readUint32(blockBuffer, 0x20)
		);
	}

	/**
	 * Get all data from V850E2 block.
	 * Add all ids found in address parameter of FS_DATA object for possible modification.
	 *
	 * @param {number} blockId - Id of current block inside activeBlocks parameter.
	 * @returns {void}
	 */
	private populateBlockData(blockId: number): void {
		// Iterator is 4 since we go word by word.
		let i: number = 4;
		let block: number = this.activeBlocks[blockId];

		// Check if the block is the last active one.
		let isLastBlock: boolean = block === this.activeBlocks.at(this.activeBlocks.length - 1);
		let nextBlock: number | undefined = isLastBlock ? undefined : this.activeBlocks[blockId + 1];
		// Read first reference word.
		let word: number = this.readUint32(this.blockData[block].buf, 0x40);
		let addr: number = i * 0x10 + block * this.blockSize;
		// Iterate through each reference until we reach the end of the block.
		while (word !== REF_END_FLAG) {
			let refAddr: number = i * 0x10 + this.blockSize * block;
			let widx: number = word >> 16;
			let id: number = word & 0xffff;
			let cksRef: number = this.readUint32(this.blockData[block].buf, i * 0x10 + 0x08);
			let dataEntry: number[] = [];
			// We do not want to throw if one data entry is corrupted, so just log it and move along.
			try {
				dataEntry = this.readDataEntry(widx, id, cksRef, this.blockData[block].rwp, nextBlock);
			} catch (e: any) {
				console.error(e.toString());
			}

			if (dataEntry.length !== 0) {
				// Add the data entry as a buffer also.
				let dataBuf: Buffer = Buffer.alloc(dataEntry.length * 4);
				for (let j = 0; j < dataEntry.length; j++) {
					let word: Buffer = this.int32ToWord(dataEntry[j]);
					word.copy(dataBuf, j * 4);
				}

				// Since we start from the top, only the latest value is kept by overwriting older values.
				this.eepData[id] = {
					id: id,
					widx: widx,
					widx_abs: widx + this.blockSize * blockId,
					length: dataEntry.length,
					data: dataEntry,
					dataBuf: dataBuf,
					addr: refAddr,
				};
			}

			// Read the next reference.
			word = this.readUint32(this.blockData[block].buf, ++i * 0x10);
			addr = i * 0x10 + block * this.blockSize;
			// We reached the last reference, we can stop the loop.
			if (this.blockData[block].rwp && addr >= this.blockData[block].rwp) {
				break;
			}
		}

		return;
	}

	/**
	 * Get given data id entry.
	 *
	 * @param {number} widx - Starting data address.
	 * @param {number} id - Fs data id.
	 * @param {number} cksRef - Checksum final value.
	 * @param {number} rwp - RWP value for current block.
	 * @param {number} [nextBlock] - Next block number, in case data entry is overlapped.
	 * @returns {number[]} Data values for given entry.
	 */
	private readDataEntry(
		widx: number,
		id: number,
		cksRef: number,
		rwp: number,
		nextBlock?: number
	): number[] {
		let data: number[] = [];
		let ofs: number = 0;
		let cks: number = 0xffffffff - id;
		let addr: number = (widx - ofs) * 8;
		let word: number = this.readUint32(this.dfBuffer, addr);
		// Length is the first 2 bytes of packet.
		// Round to next multiple of 4.
		let fixL: number = Math.ceil((word & 0xffff) / 4);

		do {
			if (addr === rwp) {
				// We reached the end of the block, but there's still data, go find it in the next block.
				if (nextBlock !== undefined) {
					let finishingData: number[] = this.getOverlapData(
						this.blockData[nextBlock].buf,
						fixL,
						data.length
					);
					data.push(...finishingData);
				} else {
					throw new RangeError(`Missing next block, invalid data for id ${this.toHexString(id)}`);
				}

				break;
			}
			// Read from full file buffer here, address is absolute, not block relative.
			word = this.readUint32(this.dfBuffer, addr);
			data.push(word);
			// Set next address.
			addr = (widx - ++ofs) * 8;
		} while (data.length < fixL);

		// Add the words to the checksum.
		data.forEach((word: number) => {
			cks -= word;
			cks = cks >>> 0;
		});

		// Check if the checksum in the reference is the same as the one we calculated with the data found.
		if (cks !== cksRef) {
			throw new Error(
				`Invalid checksum for id ${this.toHexString(id)}, address ${this.toHexString(widx * 8)}`
			);
		}

		return data;
	}

	/**
	 * Get data from last id entry that is overlapped in the next block.
	 * Data starts from the last word in the block.
	 *
	 * @param {Buffer} blockBuf - Block data buffer to search into.
	 * @param {number} fixL - Final packet length.
	 * @param {number} startL - Current packet length
	 * @returns {number[]} Overlapped data.
	 */
	private getOverlapData(blockBuf: Buffer, fixL: number, startL: number): number[] {
		let endData: number[] = [];
		let ofs: number = 0;
		do {
			let addr: number = blockBuf.length - 8 - ofs * 8;
			let word: number = this.readUint32(blockBuf, addr);
			endData.push(word);
			ofs++;
		} while (endData.length + startL < fixL);

		return endData;
	}
}

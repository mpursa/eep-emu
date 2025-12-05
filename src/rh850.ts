/**
 * INTERNAL IMPORTS
 */
import { DataFlashBlock, EepData, NecEmulator, List } from './nec_emulator';

/**
 * GLOBALS
 */
export type RhTable = {
	blockSize: number;
	prepBlocks_min: number;
	pointer_rom: number;
	pointer_ram: number;
	entries: number;
	eraseSuspend: number;
};
const BLOCK_SIZE: number = 0x800;
const ACTIVE_FLAG: number = 0x55555555;
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
export class Emu_RH850 extends NecEmulator {
	///////////////// PROPERTIES ///////////////////
	private _cfBuf: Buffer;
	private _tableHeaderAddr: number;
	private _dataTable: RhTable;

	///////////////// CONSTRUCTOR //////////////////
	/**
	 *
	 * @param {Buffer} dfBuf -
	 * @param {Buffer} cfBuffer -
	 * @param {number} tableHeaderAddr -
	 */
	public constructor(dfBuf: Buffer, cfBuffer: Buffer, tableHeaderAddr: number) {
		super(dfBuf, BLOCK_SIZE);
		this._cfBuf = cfBuffer;
		this._tableHeaderAddr = tableHeaderAddr;
		this._dataTable = this.getDataTable();
		this.populateDataInfoWTable();
		this.blockData = this.getBlocksData();
		this.activeBlocks = this.getActiveBlocksOrderedList();
		for (let i: number = 0; i < this.activeBlocks.length; i++) {
			this.populateBlockData(i);
		}
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
		let blockNum: number = this.activeBlocks[blockId];
		let block: DataFlashBlock = this.blockData[blockNum];
		if (block.rwp === 0) {
			block.rwp = this.findActiveRwp(block);
		}

		for (let i = block.rwp - 4; i > 0x20; i -= 0x10) {
			let dataEntry: EepData | undefined = this.readDataEntry(block, i);
			// Since we start from the last entry, when we find a duplicate id we do not overwrite.
			if (!dataEntry || this.eepData[dataEntry.id].data.length !== 0) {
				continue;
			}
			this.eepData[dataEntry.id] = dataEntry;
		}

		return;
	}

	/**
	 * Read EEPROM data entry
	 *
	 * @param {DataFlashBlock} block - Flash block data.
	 * @param {number} refAddr - Data entry reference address in block.
	 * @returns {EepData | undefined} EEPROM Data entry. Undefined if the entry is invalid.
	 */
	private readDataEntry(block: DataFlashBlock, refAddr: number): EepData | undefined {
		let refAbsAddr: number = refAddr + BLOCK_SIZE * block.id;
		let checkW1: number = this.readUint32(block.buf, refAddr - 0x4);
		let checkW2: number = this.readUint32(block.buf, refAddr - 0x8);
		let checkW3: number = this.readUint32(block.buf, refAddr - 0xc);
		let word: number = this.readUint32(block.buf, refAddr);
		let widx: number = word >> 0x10;
		let id: number = word & 0xffff;
		if (
			checkW1 !== ACTIVE_FLAG ||
			checkW2 !== ACTIVE_FLAG ||
			checkW3 !== ACTIVE_FLAG ||
			widx >= BLOCK_SIZE
		) {
			return undefined;
		}

		let entry: EepData = this.eepData[id];
		if (!entry || entry.length > BLOCK_SIZE) {
			return undefined;
		}

		let nWord: number = Math.ceil(entry.length);
		for (let j = 0; j < nWord; j++) {
			entry.data.push(this.readUint32(block.buf, widx - j * 4));
		}
		for (let j = 0; j < entry.data.length; j++) {
			let word: Buffer = this.int32ToWord(entry.data[j]);
			word.copy(entry.dataBuf, j * 4);
		}
		entry.widx = widx;
		entry.widx_abs = widx + BLOCK_SIZE * block.id;
		entry.addr = refAbsAddr;

		return entry;
	}

	/**
	 * Read all data entries in page until the last valid one is found.
	 * The rwp address that is found is relative to the page.
	 *
	 * @param {EepPage} page - Page data to scan.
	 * @returns {number} Assumed RWP address.
	 */
	private findActiveRwp(page: DataFlashBlock): number {
		// First possible address in block.
		let rwp: number = 0x28;
		let rwp_hypo: number = rwp;
		let dwp: number = 0x7f8;
		while (rwp < dwp) {
			let dataEntry: EepData | undefined = this.readDataEntry(page, rwp - 4);
			if (dataEntry && dataEntry.widx === dwp) {
				rwp_hypo = rwp;
				dwp -= dataEntry.length * 4;
			}

			rwp += 0x10;
		}

		return rwp_hypo;
	}

	/**
	 * Find fs data table header in codeflash file.
	 * When a valid table is not found this will throw!
	 *
	 * const r_eel_descriptor_t  sampleApp_eelConfig_enu =
	 * {
	 *    EEL_CONFIG_VBLK_SIZE,                           < Virtual block size (# physical Flash blocks)
	 *    EEL_CONFIG_VBLK_CNT_REFRESH_THRESHOLD,          < threshold for minimum no. of prepared blocks
	 *    &(IDLTab_astr[0]),                              < pointer to the ID-L table in ROM
	 *    &(IDXTab_au16[0]),                              < pointer to the ID-X table in RAM
	 *    (sizeof(IDLTab_astr) / sizeof(r_eel_ds_cfg_t)), < number of table entries
	 *    EEL_CONFIG_ERASE_SUSPEND_THRESHOLD              < threshold for erase suspend
	 *  };
	 *
	 * @returns {RhTable} Table data info.
	 */
	private getDataTable(): RhTable {
		if (this._cfBuf.length < this._tableHeaderAddr + 0x10) {
			throw new RangeError(
				`Invalid table header address ${this.toHexString(
					this._tableHeaderAddr
				)}, the codeflash is ${this.toHexString(this._cfBuf.length)} bytes`
			);
		}

		return {
			blockSize: this.readUint32(this._cfBuf, this._tableHeaderAddr) & 0xffff,
			prepBlocks_min: this.readUint32(this._cfBuf, this._tableHeaderAddr) >> 0x10,
			pointer_rom: this.readUint32(this._cfBuf, this._tableHeaderAddr + 0x04),
			pointer_ram: this.readUint32(this._cfBuf, this._tableHeaderAddr + 0x08),
			entries: this.readUint32(this._cfBuf, this._tableHeaderAddr + 0x0c) & 0xffff,
			eraseSuspend: this.readUint32(this._cfBuf, this._tableHeaderAddr + 0x0c) >> 0x10,
		};
	}

	/**
	 *
	 *
	 * @returns {void}
	 */
	private populateDataInfoWTable(): void {
		// Each entry is 4 bytes.
		let table: Buffer = Buffer.alloc(this._dataTable.entries * 4);
		// Copy from the codeflash.
		this._cfBuf.copy(
			table,
			0,
			this._dataTable.pointer_rom,
			this._dataTable.pointer_rom + this._dataTable.entries * 4
		);
		// Table data acquisition and validation.
		for (let i = 0; i < table.length; i += 4) {
			let word: number = this.readUint32(table, i);
			let length: number = word >> 16;
			let id: number = word & 0xffff;
			// Already prepare each eeprom id.
			this.eepData[id] = {
				id: id,
				widx: 0,
				widx_abs: 0,
				length: length / 4,
				data: [],
				dataBuf: Buffer.alloc(length * 4),
				addr: 0,
			};

			// Length cannot be > BLOCK_SIZE beacuase there's no overlap system in RH850.
			if (length > BLOCK_SIZE) {
				throw new Error(
					`Invalid rh850 table (id -> ${this.toHexString(id, 4)}, length -> ${this.toHexString(
						length,
						4
					)})`
				);
			}
		}

		return;
	}

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
				eraseCount: this.readUint32(blockBuffer.subarray(0x10, 0x13)),
				rwp: 0,
				buf: blockBuffer,
			};
			// If the block is not valid, we skip getting other info.
			if (!blocks[i].isValid) {
				continue;
			}
			// Add the rwp to the found ones.
			rwps.push(this.readUint32(blockBuffer.subarray(0x14, 0x17)));
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
	 * @param {Buffer} buf - Block content.
	 * @returns {boolean} Content is an active RH850 block.
	 */
	private isValidBlock(buf: Buffer): boolean {
		return (
			// Prepare and active flags must be 55 55 55 55.
			ACTIVE_FLAG === this.readUint32(buf, 0x4) &&
			ACTIVE_FLAG === this.readUint32(buf, 0x8) &&
			ACTIVE_FLAG === this.readUint32(buf, 0xc) &&
			// Invalid flags must not be 55 55 55 55.
			/**
			 * @note @mpursa
			 * Since the flags are deleted when the block is active, it might still read 55 55 55 55
			 * due to the way dataflashes are read in rh850.
			 * All the other flags and checksums are written, so they must be correct!
			 */
			// Checksum erase counter.
			0xff === this.checkSum8bit(buf, 0x10, 0x13) &&
			// Checksum rwp.
			0xff === this.checkSum8bit(buf, 0x14, 0x17)
		);
	}
}

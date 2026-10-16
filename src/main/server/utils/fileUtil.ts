import fs from "fs";
import Ffmpeg from "@ts-ffmpeg/fluent-ffmpeg";
import { zipSync } from "fflate";
import type { PassThrough, Readable, Writable } from "stream";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";

Ffmpeg.setFfmpegPath(ffmpegPath);
function toU8(buf: Buffer | Uint8Array): Uint8Array {
	return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}
export default {
	convertToMp3(data: Readable, fileExt: string): Promise<PassThrough | Writable> {
		return new Promise((res, rej) => {
			const command = Ffmpeg(data)
				.inputFormat(fileExt)
				.toFormat("mp3")
				.audioBitrate(4.4e4)
				.on("error", (err) => rej(err));
			res(command.pipe() as PassThrough);
		});
	},
	zippy(fileName: string, zipName: string): Buffer {
		if (!fs.existsSync(fileName)) {
			throw new Error(`File '${fileName}' doesn't exist.`);
		}
		const buffer = fs.readFileSync(fileName);
		const zipped = zipSync({
			[zipName]: toU8(buffer),
		});
		return Buffer.from(zipped);
	},
	addToZip(files: Record<string, Uint8Array>, zipName: string, buffer: Buffer | Uint8Array) {
		files[zipName] = toU8(buffer);
	},
};

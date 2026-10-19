import fs from "fs";
import { zipSync } from "fflate";
import { PassThrough } from "stream";
import type { Readable, Writable } from "stream";
import { spawn } from "child_process";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";

function toU8(buf: Buffer | Uint8Array): Uint8Array {
	return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}
export default {
	convertToMp3(data: Readable | string, fileExt: string): Promise<PassThrough | Writable> {
		return new Promise((res, resRej) => {
			let rejected = false;
			const rej = (err: Error) => {
				if (rejected) return;
				rejected = true;
				resRej(err);
			};
			const isStream = typeof data !== "string";
			const inputSource = isStream ? "pipe:0" : data;
			const ffmpegProcess = spawn(ffmpegPath, [ "-hide_banner", "-loglevel", "error", "-f", fileExt, "-i", inputSource, "-b:a", "192k", "-f", "mp3", "pipe:1" ]);
			const outputStream = new PassThrough();
			if (isStream) {
				(data as Readable).pipe(ffmpegProcess.stdin);
			} else {
				ffmpegProcess.stdin.end();
			}
			ffmpegProcess.stdout.pipe(outputStream);
			ffmpegProcess.on("error", (err) => rej(err));
			if (isStream) {
				(data as Readable).on("error", (err) => rej(err));
			}
			ffmpegProcess.stderr.on("data", (chunk) => {
				rej(new Error(`FFmpeg error: ${chunk.toString()}`));
			});
			res(outputStream);
		});
	},
	zippy(fileName: string, zipName: string): Buffer {
		if (!fs.existsSync(fileName)) {
			throw new Error(`File '${fileName}' doesn't exist.`);
		}
		const buffer = fs.readFileSync(fileName);
		const zipped = zipSync({ [zipName]: toU8(buffer), });
		return Buffer.from(zipped);
	},
	addToZip(files: Record<string, Uint8Array>, zipName: string, buffer: Buffer | Uint8Array) { files[zipName] = toU8(buffer); },
};

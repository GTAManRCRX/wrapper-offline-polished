import fs from "fs";
import Ffmpeg from "@ts-ffmpeg/fluent-ffmpeg";
import AdmZip from "adm-zip";
import type { PassThrough, Readable, Writable } from "stream";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";

Ffmpeg.setFfmpegPath(ffmpegPath);

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
		const zip = new AdmZip();
		this.addToZip(zip, zipName, buffer);
		return zip.toBuffer();
	},

	addToZip(zip: AdmZip, zipName: string, buffer: Buffer) {
		zip.addFile(zipName, buffer);
	},
};

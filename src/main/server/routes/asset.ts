import type { Asset } from "../models/asset";
import AssetModel from "../models/asset";
import Directories from "../../storage/directories";
import fileTypes from "../data/allowed_file_types.json";
import fileUtil from "../utils/fileUtil";
import fs from "fs";
import httpz from "@octanuary/httpz";
import MovieModel from "../models/movie";
import path from "path";
import { randomBytes } from "crypto";
import { Readable } from "stream";
import { exec } from "child_process";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { path as ffprobePath } from "@ffprobe-installer/ffprobe";

const group = new httpz.Group();

const uploadProgressMap = new Map<string, number>();

function getMediaInfo(filepath: string): Promise<any> {
	return new Promise((resolve, reject) => {
		exec(`"${ffprobePath}" -v error -show_entries format=duration -show_entries stream=width,height -of json "${filepath}"`, (error, stdout) => {
			if (error) return reject(error);
			try {
				resolve(JSON.parse(stdout.toString()));
			} catch (e) {
				reject(e);
			}
		});
	});
}
group.route("POST", "/api_v2/asset/delete/", async (req, res) => {
	const idField = req.body.data?.id || req.body.data?.starter_id;
	if (typeof idField == "undefined") {
		return res.status(400).json({ status: "error", msg: "Missing required parameters" });
	}
	const ids = idField.split(",");
	for (const id of ids) {
		try {
			const asset = AssetModel.getInfo(id);
			if (!asset) throw "404";
			if (asset.type == "movie") {
				await MovieModel.delete(id);
			} else {
				await AssetModel.delete(id);
			}
			console.log("Deleted asset " + id);
		} catch (err) {
			if (err == "404") {
				console.log(`Failed to delete asset ${id}`);
			} else {
				console.error(`Failed to delete asset ${id} ${err}`);
				return res.status(500).json({ status: "error", msg: "Internal server error" });
			}
		}
	}
	res.json({ status: "ok" });
});
group.route("GET", "/api/asset/list", (req, res) => {
	const filter = { type: ["bg", "prop", "sound"] as any as Asset["type"] };
	const list = AssetModel.list(filter, false) || [];
	res.json(list);
});
group.route("POST", "/api_v2/assets/imported", (req, res) => {
	if (!req.body.data.type) {
		return res.status(400).json({ msg: "Expected data.type on request body" });
	}
	if (req.body.data.type == "prop") {
		req.body.data.subtype ||= "0";
	}
	const filters: Partial<Asset> = { type: req.body.data.type };
	if (req.body.data.subtype) filters.subtype = req.body.data.subtype;
	res.json({ status: "ok", data: { xml: AssetModel.list(filters, true) } });
});
group.route("POST", "/goapi/getUserAssetsXml/", (req, res) => {
	if (req.body.type !== "char") {
		res.status(307).setHeader("Location", "/api_v2/assets/imported");
		return res.end();
	} else if (!req.body.themeId) {
		return res.status(400).end("1<error><code>malformed</code><message/></error>");
	}
	let themeId: string;
	switch (req.body.themeId) {
		case "custom":
			themeId = "family";
			break;
		case "action":
		case "animal":
		case "space":
		case "vietnam":
			themeId = "cc2";
			break;
		default:
			themeId = req.body.themeId;
	}
	const filters: Partial<Asset> = { themeId, type: "char" };
	if (req.body.assetId && req.body.assetId !== "null") filters.id = req.body.assetId;
	res.setHeader("Content-Type", "application/xml");
	res.end(AssetModel.list(filters, true));
});
group.route("*", /^\/(assets|goapi\/getAsset)\/([\S]*)$/, (req, res) => {
	let id = req.method === "GET" ? req.matches[2] : req.body.assetId;
	if (!id) return res.status(400).end();
	try {
		const ext = path.extname(id).toLowerCase();
		const mimeTypes: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".swf": "application/x-shockwave-flash", ".mp3": "audio/mpeg" };
		const mime = mimeTypes[ext] || "application/octet-stream";
		res.writeHead(200, { "Content-Type": mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });
		const readStream = AssetModel.load(id, false);
		readStream.pipe(res);
	} catch (e) {
		if (!res.writableEnded) res.status(404).end();
	}
});
group.route("POST", "/api_v2/asset/get", (req, res) => {
	const id = req.body.data?.id ?? req.body.data?.starter_id;
	if (!id) {
		return res.status(404).json({ status: "error" });
	}
	try {
		const info = AssetModel.getInfo(id);
		const extraInfo = { share: { type: "none" }, published: "" };
		res.json({ status: "ok", data: Object.assign(info, extraInfo) });
	} catch (e) {
		if (e == "404") {
			return res.status(404).json({ status: "error" });
		}
		console.error(req.parsedUrl.pathname, "failed. Error:", e);
		res.status(500).json({ status: "error" });
	}
});
group.route("POST", "/goapi/getAssetTags/", (_, r) => r.json([]));
group.route("POST", "/goapi/getLatestAssetId/", (_, r) => { r.setHeader("Content-Type", "text/html"); r.end("0"); });
group.route("POST", "/api_v2/asset/update/", (req, res) => {
	const id = req.body.data?.id ?? req.body.data?.starter_id ?? null;
	const title = req.body.data?.title ?? null;
	const tags = req.body.data?.tags ?? null;
	if (!id || title === null) {
		return res.status(400).json({ status: "error" });
	}
	const update: Partial<Asset> = { title: title };
	if (req.body.data?.hasOwnProperty("tags")) {
		if (tags && String(tags).trim() !== "") {
			update.tags = tags;
		} else {
			update.tags = undefined;
		}
	}
	try {
		AssetModel.updateInfo(id, update);
		res.json({ status: "ok" });
	} catch (e) {
		if (e == "404") {
			return res.status(404).json({ status: "error" });
		}
		console.error(req.parsedUrl.pathname, "failed. Error:", e);
		res.status(500).json({ status: "error" });
	}
});
group.route("POST", "/api/asset/upload", async (req, res) => {
	const file = req.files.import;
	if (typeof file === "undefined" || !req.body.type || !req.body.subtype) {
		return res.status(400).json({ msg: "Missing required parameters" });
	}
	const { filepath } = file;
	const filename = path.parse(file.originalFilename).name;
	const ext = path.extname(file.originalFilename).slice(1).toLowerCase();
	if (!ext) {
		return res.status(400).json({ msg: "File type could not be determined" });
	}
	const progressId = req.body.progressId || randomBytes(8).toString("hex");
	uploadProgressMap.set(progressId, 5);
	let info: Partial<Asset> = { type: req.body.type, subtype: req.body.subtype, title: req.body.name || filename };
	let stream: any;
	let finalExt = ext;
	const ok = info.subtype == "video" ? "video" : info.type;
	if ((fileTypes[ok] || []).indexOf(ext) < 0) {
		uploadProgressMap.delete(progressId);
		return res.status(400).json({ msg: "Invalid file type" });
	}
	if (ext !== "swf" && ["webp", "tif", "tiff", "avif"].includes(ext)) {
		await new Promise((resolve, reject) => {
			exec(`"${ffmpegPath}" -hide_banner -loglevel error -i "${filepath}" -f image2pipe -vcodec png -`, (err, buffer) => {
				if (err) return reject(err);
				stream = Readable.from(buffer);
				finalExt = "png";
				resolve(true);
			});
		}).catch(() => {
			uploadProgressMap.delete(progressId);
			return res.status(500).json({ msg: "Conversion failed" });
		});
	}
	try {
		uploadProgressMap.set(progressId, 25);
		switch (info.type) {
			case "bg": {
				if (finalExt != "swf") {
					await new Promise((resolve, reject) => {
						exec(`"${ffmpegPath}" -hide_banner -loglevel error -i "${filepath}" -vf "scale=550:354:flags=bicubic,unsharp=3:3:0.5:3:3:0.0" -f image2pipe -vcodec png -`, async (err, buffer) => {
							if (err) return reject(err);
							stream = Readable.from(buffer);
							finalExt = "png";
							uploadProgressMap.set(progressId, 75);
							resolve(true);
						});
					});
				} else {
					stream = fs.createReadStream(filepath);
				}
				info.id = await AssetModel.save(stream, finalExt, info);
				break;
			}
			case "sound": {
				let soundStream;
				if (ext != "mp3") {
					soundStream = await fileUtil.convertToMp3(filepath, ext);
				} else {
					soundStream = fs.createReadStream(filepath);
				}
				const temppath = path.join(Directories.asset, `${randomBytes(16).toString("hex")}.mp3`);
				const writeStream = fs.createWriteStream(temppath);
				await new Promise((resolve, reject) => {
					const timer = setTimeout(() => { 
						writeStream.close();
						if (fs.existsSync(temppath)) fs.unlinkSync(temppath);
						reject("Read stream timed out");
					}, 1.2e6);
					soundStream.on("end", () => { clearTimeout(timer); resolve(true); }).pipe(writeStream);
				});
				uploadProgressMap.set(progressId, 60);
				const ffdata = await getMediaInfo(temppath);
				info.duration = Math.floor(parseFloat(ffdata.format.duration) * 1e3);
				uploadProgressMap.set(progressId, 85);
				info.id = await AssetModel.save(temppath, "mp3", info);
				if (fs.existsSync(temppath)) fs.unlinkSync(temppath);
				break;
			}
			case "prop": {
				if (info.subtype == "video") {
					const ffdata = await getMediaInfo(filepath);
					info.width = ffdata.streams?.[0]?.width || (ffdata.streams?.[1] ? ffdata.streams[1].width : 0);
					info.height = ffdata.streams?.[0]?.height || (ffdata.streams?.[1] ? ffdata.streams[1].height : 0);					
					const temppath = path.join(Directories.asset, `${randomBytes(16).toString("hex")}.flv`);
					uploadProgressMap.set(progressId, 45);
					await new Promise((resolve, reject) => {
						exec(`"${ffmpegPath}" -hide_banner -loglevel error -y -i "${filepath}" -q:v 2 "${temppath}"`, (err) => {
							if (err) return reject(err);
							resolve(true);
						});
					});
					uploadProgressMap.set(progressId, 80);
					info.id = await AssetModel.save(temppath, "flv", info);
					if (fs.existsSync(temppath)) fs.unlinkSync(temppath);
					const thumbPath = path.join(AssetModel.folder, info.id.slice(0, -3) + "png");
					await new Promise((resolve) => {
						exec(`"${ffmpegPath}" -hide_banner -loglevel error -y -ss 00:00:00 -i "${filepath}" -frames:v 1 "${thumbPath}"`, () => {
							resolve(true);
						});
					});
				} else if (info.subtype == "0") {
					let { ptype } = req.body;
					info.ptype = ["placeable", "wearable", "holdable"].includes(ptype) ? ptype : "placeable";
					if (!stream) {
						stream = fs.createReadStream(filepath);
					}
					if (stream instanceof fs.ReadStream) {
						stream.pause();
					}
					info.id = await AssetModel.save(stream, finalExt, info);
				}
				break;
			}
			default: {
				uploadProgressMap.delete(progressId);
				return res.status(400).json({ msg: "Invalid asset type" });
			}
		}
		uploadProgressMap.set(progressId, 100);
		setTimeout(() => uploadProgressMap.delete(progressId), 5000);
		res.json(info);
	} catch (e) {
		uploadProgressMap.delete(progressId);
		console.error(req.parsedUrl.pathname, "failed. Error:", e);
		res.status(500).json({ status: "error" });
	}
});
group.route("POST", "/goapi/saveSound/", async (req, res) => {
	const isRecord = !!req.body.bytes;
	let filepath: string;
	let ext: string;
	let stream: any;
	if (isRecord) { ext = "ogg"; filepath = path.join(Directories.asset, `${randomBytes(16).toString("hex")}.${ext}`); const buffer = Buffer.from(req.body.bytes, "base64"); fs.writeFileSync(filepath, buffer);
	} else {
		filepath = req.files.Filedata.filepath;
		ext = path.extname(req.files.Filedata.originalFilename || filepath) .slice(1) .toLowerCase();
		if (!ext) {
			return res.status(400).json({ msg: "File type could not be determined" });
		}
	}
	const info: Partial<Asset> = { type: "sound", subtype: req.body.subtype, title: req.body.title };
	try {
		let tempToUnlink: string | null = null;
		if (ext != "mp3") {
			stream = await fileUtil.convertToMp3(filepath, ext);
			const temppath = path.join(Directories.asset, `${randomBytes(16).toString("hex")}.mp3`);
			tempToUnlink = temppath;
			const writeStream = fs.createWriteStream(temppath);
			await new Promise((resolve, reject) => { stream .pipe(writeStream) .on("finish", resolve) .on("error", reject);
			});
			if (isRecord && fs.existsSync(filepath)) { fs.unlinkSync(filepath); }
			filepath = temppath;
		}	
		const ffdata = await getMediaInfo(filepath);
		const duration = Math.floor(parseFloat(ffdata.format.duration) * 1e3);
		const meta = { duration, type: "sound", subtype: info.subtype || "Voiceover", title: info.title || "Microphone recording" };
		const id = await AssetModel.save(filepath, "mp3", meta);
		if (tempToUnlink && fs.existsSync(tempToUnlink)) {
			fs.unlinkSync(tempToUnlink);
		}
		if (isRecord && ext == "mp3" && fs.existsSync(filepath)) {
			fs.unlinkSync(filepath);
		}
		const safeTitle = (meta.title || "") .replace(/&/g, "&amp;") .replace(/</g, "&lt;") .replace(/>/g, "&gt;");
		const responseXml = `<asset><id>${id}</id><enc_asset_id>${id}</enc_asset_id><type>sound</type><subtype>voiceover</subtype><title>${safeTitle}</title><published>1</published><tags>speech</tags><duration>${duration}</duration><downloadtype>progressive</downloadtype><file>${id}</file></asset>`;
		res.setHeader("Content-Type", "text/html; charset=UTF-8");
		res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
		res.setHeader("Pragma", "no-cache");
		res.setHeader("Expires", "0");
		res.setHeader("Surrogate-Control", "content=\"no-store\"");
		res.end(`0${responseXml}`);
	} catch (e) {
		console.error("Microphone save post-processing error:", e);
		if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
		res.end(`1<error><code>ERR_ASSET_500</code><message>Microphone processing failed</message></error>`);
	}
});
export default group;

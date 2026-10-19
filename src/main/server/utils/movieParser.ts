import AssetModel, { Asset } from "../models/asset";
import type { Char } from "../models/char";
import CharModel from "../models/char";
import database from "../../storage/database";
import Directories from "../../storage/directories";
import fs from "fs";
import path from "path";
import { zipSync, unzipSync } from "fflate";

const source = path.join(Directories.static, process.env.CLIENT_URL);
const store = path.join(Directories.static, process.env.STORE_URL);
const header = process.env.XML_HEADER;

type XmlNode = { type: "element" | "text" | "cdata" | "document"; name?: string; attributes?: Record<string, string>; children?: XmlNode[]; text?: string; };

function parseXml(str: string): XmlNode {
	const root: XmlNode = { type: "document", children: [] };
	const stack: XmlNode[] = [root];
	const tagRe = /<\/?([A-Za-z0-9:_-]+)([^>]*)>|<!\[CDATA\[(.*?)\]\]>|([^<]+)/gs;
	for (const match of str.matchAll(tagRe)) {
		if (match[0].startsWith("<![CDATA[")) {
			const node: XmlNode = { type: "cdata", text: match[3] };
			const parent = stack[stack.length - 1]; (parent.children ??= []).push(node);
			continue;
		}
		if (match[4] !== undefined) {
			const txt = match[4].trim();
			if (txt) {
				const node: XmlNode = { type: "text", text: txt };
				const parent = stack[stack.length - 1]; (parent.children ??= []).push(node);
			}
			continue;
		}
		const isEnd = match[0].startsWith("</");
		const tagName = match[1];
		const attrStr = match[2] ?? "";
		if (isEnd) {
			const popped = stack.pop();
			if (!popped || popped.name !== tagName) {
				throw new Error(`Mismatched closing tag: </${tagName}>`);
			}
			continue;
		}
		const selfClosing = /\/\s*>$/.test(match[0]);
		const attrs: Record<string, string> = {};
		const attrRe = /([A-Za-z0-9:_-]+)\s*=\s*"([^"]*)"/g;
		for (const a of attrStr.matchAll(attrRe)) {
			attrs[a[1]] = a[2];
		}
		const node: XmlNode = { type: "element", name: tagName, attributes: Object.keys(attrs).length ? attrs : undefined, children: [], };
		const parent = stack[stack.length - 1]; (parent.children ??= []).push(node);
		if (!selfClosing) {
			stack.push(node);
		}
	}
	if (stack.length !== 1) {
		throw new Error("Unbalanced XML tags");
	}
	return root;
}
function elements(node: XmlNode | undefined, name?: string): XmlNode[] {
	if (!node?.children) return [];
	return node.children.filter( (c) => c.type === "element" && (name == null || c.name === name) );
}
function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
	return elements(node, name)[0];
}
function childText(node: XmlNode | undefined, name: string): string | undefined {
	const el = child(node, name);
	if (!el?.children) return undefined;
	const t = el.children.find((c) => c.type === "text" || c.type === "cdata");
	return t?.text;
}
function attr(node: XmlNode | undefined, name: string): string | undefined { return node?.attributes?.[name]; }
function clearElement(node: XmlNode) { node.name = "ELEMENT"; node.attributes = {}; node.children = []; }
function escapeXml(s: string): string { return s .replace(/&/g, "&amp;") .replace(/</g, "&lt;") .replace(/>/g, "&gt;") .replace(/"/g, "&quot;"); }
function serialize(node: XmlNode): string {
	if (node.type === "text" || node.type === "cdata") {
		return escapeXml(node.text || "");
	}
	if (node.type !== "element" || !node.name) return "";
	const attrs = node.attributes ? Object.entries(node.attributes) .map(([k, v]) => ` ${k}="${escapeXml(v)}"`) .join("") : "";
	const inner = (node.children ?? []).map(serialize).join("");
	if (!inner) return `<${node.name}${attrs}/>`;
	return `<${node.name}${attrs}>${inner}</${node.name}>`;
}
function serializeDocument(root: XmlNode): string {
	const rootEl = root.type === "document" ? root.children?.find((c) => c.type === "element") : root;
	if (!rootEl) return "";
	return (header || "") + serialize(rootEl);
}
function getRootElement(doc: XmlNode): XmlNode {
	if (doc.type === "document") {
		const el = doc.children?.find((c) => c.type === "element");
		if (!el) throw new Error("No root element");
		return el;
	}
	return doc;
}
function fontId2File(font: string) {
	switch (font) {
		case "Blambot Casual":
			return "FontFileCasual";
		case "BadaBoom BB":
			return "FontFileBoom";
		case "Entrails BB":
			return "FontFileEntrails";
		case "Tokyo Robot Intl BB":
			return "FontFileTokyo";
		case "Accidental Presidency":
			return "FontFileAccidental";
		case "Budmo Jiggler":
			return "FontFileBJiggler";
		case "Budmo Jigglish":
			return "FontFileBJigglish";
		case "Existence Light":
			return "FontFileExistence";
		case "HeartlandRegular":
			return "FontFileHeartland";
		case "Honey Script":
			return "FontFileHoney";
		case "I hate Comic Sans":
			return "FontFileIHate";
		case "loco tv":
			return "FontFileLocotv";
		case "Mail Ray Stuff":
			return "FontFileMailRay";
		case "Mia's Scribblings ~":
			return "FontFileMia";
		case "Coming Soon":
			return "FontFileCSoon";
		case "Lilita One":
			return "FontFileLOne";
		case "Telex Regular":
			return "FontFileTelex";
		case "":
		case null:
			return "";
		default:
			return `FontFile${String(font).replace(/\s/g, "")}`;
	}
}
function toU8(buf: Buffer | Uint8Array): Uint8Array { return buf instanceof Uint8Array ? buf : new Uint8Array(buf); }
export default {
	async pack(xmlBuffer: Buffer, thumbBuffer?: Buffer): Promise<Buffer> {
		if (xmlBuffer.length === 0) throw null;
		const files: Record<string, Uint8Array> = {};
		const themes: Record<string, boolean> = { common: true };
		let ugc = `${header}<theme id="ugc" name="ugc">`;
		let changesMade = false;
		async function basicParse(file: string, type: string, subtype?: string) {
			const pieces = file.split(".");
			const themeId = pieces[0];
			const ext = pieces.pop()!; pieces[pieces.length - 1] += "." + ext; pieces.splice(1, 0, type);
			const filename = pieces.join(".");
			let buffer: Buffer;
			try {
				if (themeId === "ugc") {
					const id = pieces[2]; buffer = AssetModel.load(id, true);
					const assetMeta = database.get("assets", id);
					if (!assetMeta) throw new Error(`Asset #${id} is in the XML`); ugc += AssetModel.meta2Xml(assetMeta.data);
					if (type === "prop" && subtype === "video") { pieces[2] = pieces[2].slice(0, -3) + "png";
						const thumbFilename = pieces.join(".");
						const thumbBuf = AssetModel.load(pieces[2], true);
						files[thumbFilename] = toU8(thumbBuf);
					}
				} else {
					if (type === "prop" && pieces.indexOf("head") > -1) {
						pieces[1] = "char";
					}
					const filepath = `${store}/${pieces.join("/")}`;
					buffer = fs.readFileSync(filepath);
				}
			} catch {
				console.error(`WARNING: Asset failed to load`);
				return false;
			}
			files[filename] = toU8(buffer);
			themes[themeId] = true;
			return true;
		}
		const doc = parseXml(xmlBuffer.toString()) as XmlNode;
		const film = getRootElement(doc);
		for (const elem of elements(film, "sound")) {
			const file = childText(elem, "sfile");
			if (!file) continue;
			const success = await basicParse(file, "sound");
			if (!success) {
				clearElement(elem);
				changesMade = true;
			}
		}
		for (const scene of elements(film, "scene")) {
			for (const elem2 of elements(scene)) {
				let tag = elem2.name || "";
				if (tag === "effectAsset") tag = "effect";
				switch (tag) {
					case "durationSetting":
					case "trans":
						break;
					case "bg":
					case "effect":
					case "prop": {
						const file = childText(elem2, "file");
						if (!file) continue;
						const success = await basicParse(file, tag, attr(elem2, "subtype"));
						if (!success) {
							clearElement(elem2);
							changesMade = true;
						}
						break;
					}
					case "char": {
						let file = childText(elem2, "action");
						if (!file) continue;
						const pieces = file.split(".");
						const themeId = pieces[0];
						const ext = pieces.pop()!;
						pieces[pieces.length - 1] += "." + ext;
						pieces.splice(1, 0, "char");
						if (themeId === "ugc") {
							pieces.splice(3, 1);
							const id = pieces[2];
							try {
								const charXml = CharModel.charXml(id);
								const filename = pieces.join(".");
								ugc += AssetModel.meta2Xml({ id, type: "char", themeId: CharModel.getThemeId(charXml), } as Char);
								files[filename + ".xml"] = toU8(charXml);
							} catch {
								clearElement(elem2);
								changesMade = true;
							}
						} else {
							const filepath = `${store}/${pieces.join("/")}`;
							const filename = pieces.join(".");
							try {
								files[filename] = toU8(fs.readFileSync(filepath));
							} catch {
								clearElement(elem2);
								changesMade = true;
							}
						}
						for (const elem3 of elements(elem2)) {
							if (!elem3.children?.length) continue;
							file = childText(elem3, "file");
							if (!file) continue;
							const pieces2 = file.split(".");
							if (elem3.name !== "head") {
								const success = await basicParse(file, "prop");
								if (!success) {
									clearElement(elem3);
									changesMade = true;
								}
							} else {
								if (pieces2[0] === "ugc") continue;
								pieces2.pop();
								pieces2.splice(1, 0, "char");
								const filepath = `${store}/${pieces2.join("/")}.swf`;
								pieces2.splice(1, 1, "prop");
								const filename = `${pieces2.join(".")}.swf`;
								try {
									files[filename] = toU8(fs.readFileSync(filepath));
								} catch {
									clearElement(elem3);
									changesMade = true;
								}
							}
							themes[pieces2[0]] = true;
						}
						themes[themeId] = true;
						break;
					}
					case "bubbleAsset": {
						const bubble = child(elem2, "bubble");
						const text = child(bubble, "text");
						const font = attr(text, "font");
						if (!font || font === "Arial") continue;
						const filename = `${fontId2File(font)}.swf`;
						const filepath = `${source}/go/font/${filename}`; files[filename] = toU8(fs.readFileSync(filepath));
						break;
					}
				}
			}
		}
		if (themes.family) {
			delete themes.family;
			themes.custom = true;
		}
		if (themes.cc2) {
			delete themes.cc2;
			themes.action = true;
		}
		const themeIds = Object.keys(themes);
		for (const themeId of themeIds) {
			if (themeId === "ugc") continue;
			const xmlPath = `${store}/${themeId}/theme.xml`; files[`${themeId}.xml`] = toU8(fs.readFileSync(xmlPath));
		}
		files["themelist.xml"] = toU8(
			Buffer.from( `${header}<themes>${themeIds .map((t) => `<theme>${t}</theme>`) .join("")}</themes>` )
		);
		files["ugc.xml"] = toU8(Buffer.from(ugc + "</theme>"));
		if (thumbBuffer) files["thumbnail.png"] = toU8(thumbBuffer);
		if (changesMade) xmlBuffer = Buffer.from(serializeDocument(doc));
		files["movie.xml"] = toU8(xmlBuffer);
		return Buffer.from(zipSync(files));
	},
	async extractAudioTimes(xmlBuffer: Buffer) {
		const doc = parseXml(xmlBuffer.toString()) as XmlNode;
		const film = getRootElement(doc);
		const audios = elements(film, "sound");
		return audios.map((v) => {
			const pieces = childText(v, "sfile")!.split(".");
			const themeId = pieces[0];
			const ext = pieces.pop()!; pieces[pieces.length - 1] += "." + ext; pieces.splice(1, 0, "sound");
			const filepath = themeId === "ugc" ? path.join(AssetModel.folder, pieces[pieces.length - 1]) : path.join(store, pieces.join("/"));
			const fadein = child(v, "fadein");
			const fadeout = child(v, "fadeout");
			return { filepath, start: +childText(v, "start")!, stop: +childText(v, "stop")!, trimStart: +(childText(v, "trimStart") || 0), trimEnd: +(childText(v, "trimEnd") || 0), fadeIn: { duration: +attr(fadein, "duration")!, vol: +attr(fadein, "vol")!, }, fadeOut: { duration: +attr(fadeout, "duration")!, vol: +attr(fadeout, "vol")!, }, };
		});
	},
	async unpack(body: Buffer): Promise<[Buffer, Buffer]> {
		const zipFiles = unzipSync(new Uint8Array(body));
		const ugcU8 = zipFiles["ugc.xml"];
		if (!ugcU8) throw new Error("ugc.xml not found");
		const doc = parseXml(Buffer.from(ugcU8).toString()) as XmlNode;
		const ugc = getRootElement(doc);
		for (const elem of elements(ugc, "background")) {
			const id = attr(elem, "id")!;
			if (!AssetModel.exists(id)) {
				const buffer = zipFiles[`ugc.bg.${id}`];
				if (buffer) { AssetModel.save(Buffer.from(buffer), id, { type: "bg", subtype: "0", title: attr(elem, "name"), id, });
				}
			}
		}
		for (const elem of elements(ugc, "prop")) {
			const id = attr(elem, "id")!;
			if (!AssetModel.exists(id)) {
				const buffer = zipFiles[`ugc.prop.${id}`];
				if (buffer) {
					if (attr(elem, "subtype") === "video") { AssetModel.save(Buffer.from(buffer), id, { type: "prop", subtype: "video", title: attr(elem, "name"), width: +attr(elem, "width")!, height: +attr(elem, "height")!, id, } as Asset);
						const thumbName = `ugc.prop.${id.slice(0, -4)}.png`;
						const buffer2 = zipFiles[thumbName];
						if (buffer2) {
							fs.writeFileSync( path.join(AssetModel.folder, id.slice(0, -4) + ".png"), Buffer.from(buffer2) );
						}
					} else {
						AssetModel.save(Buffer.from(buffer), id, { type: "prop", subtype: "0", title: attr(elem, "name"), ptype: attr(elem, "wearable") === "1" ? "wearable" : attr(elem, "holdable") === "1" ? "holdable" : "placeable", id, });
					}
				}
			}
		}
		for (const elem of elements(ugc, "char")) {
			const id = attr(elem, "id")!;
			if (!CharModel.exists(id)) {
				const buffer = zipFiles[`ugc.char.${id}.xml`];
				if (buffer) {
					CharModel.save(Buffer.from(buffer), { type: "char", subtype: "0", title: attr(elem, "name"), themeId: CharModel.getThemeId(Buffer.from(buffer)), id, });
				}
			}
		}
		for (const elem of elements(ugc, "sound")) {
			const subtype = attr(elem, "subtype");
			if (!["bgmusic", "soundeffect", "voiceover", "tts"].includes(subtype || ""))
				continue;
			const id = attr(elem, "id")!;
			if (!AssetModel.exists(id)) {
				const buffer = zipFiles[`ugc.sound.${id}`];
				if (buffer) { AssetModel.save(Buffer.from(buffer), id, { duration: +attr(elem, "duration")!, type: "sound", subtype, title: attr(elem, "name"), id, });
				}
			}
		}
		const movieXml = zipFiles["movie.xml"] ? Buffer.from(zipFiles["movie.xml"]) : Buffer.alloc(0);
		const thumbnail = zipFiles["thumbnail.png"] ? Buffer.from(zipFiles["thumbnail.png"]) : Buffer.alloc(0);
		return [movieXml, thumbnail];
	},
};

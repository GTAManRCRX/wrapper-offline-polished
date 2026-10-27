import Database, { generateId } from "../../storage/database";
import Directories from "../../storage/directories";
import fs from "fs";
import path from "path";

export type Char = { type: "char", subtype: "0", title: string, tags?: string, themeId: string, id: string, };
export default class CharModel {
	static folder = Directories.asset;
	static baseThumbUrl = path.join(Directories.static, process.env.CHAR_BASE_URL);
	static charXml(id:string): Buffer {
		try {
			const localXmlPath = path.join(this.folder, `${id}.xml`);
			if (fs.existsSync(localXmlPath)) {
				return fs.readFileSync(localXmlPath);
			}
			const nId = (id.slice(0, -3) + "000").padStart(9, "0");
			const stockCharPath = path.join(this.baseThumbUrl, `${nId}.txt`);
			if (!fs.existsSync(stockCharPath)) {
				throw "404";
			}
			const chars = fs.readFileSync(stockCharPath);
			const line = chars.toString("utf8") .split("\n") .find((v) => v.substring(0, 3) == id.slice(-3));
			if (line) {
				return Buffer.from(line.substring(3));
			}
			throw "404";
		} catch (err) {
			if (err !== "404") {
				console.log(err);
			}
			throw "404";
		}
	}
	static save(xml:Buffer, info:Partial<Char>): string {
		info.id ||= generateId(); Database.insert("assets", info as Char);
		if (!this.isSkeleton(info.themeId) && xml.indexOf("version=\"2.0\"") == -1) {
			const end = xml.indexOf(">", xml.indexOf("<cc_char"));
			xml = Buffer.concat([ xml.subarray(0, end), Buffer.from(" version=\"2.0\""), xml.subarray(end) ]);
		}
		fs.writeFileSync(path.join(this.folder, `${info.id}.xml`), xml);
		return info.id;
	}
	static saveThumb(id:string, thumb:Buffer) {
		fs.writeFileSync(path.join(this.folder, `${id}.png`), thumb);
	}
	static exists(id:string): boolean {
		try { this.charXml(id);
			return true;
		} catch (err) {
			return false;
		}
	}
	static getThemeId(charXml:Buffer) {
		const beg = charXml.indexOf(`theme_id="`) + 10;
		const end = charXml.indexOf(`"`, beg);
		return charXml.subarray(beg, end).toString();
	}
	static isSkeleton(themeId:string) {
		switch (themeId) {
			case "cctoonadventure":
			case "family":
				return true;
		}
		return false;
	}
};

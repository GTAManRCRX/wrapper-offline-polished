import { apiServer } from "./AppInit";

export default async function openPlayerWindow(movieId: string) {
	const isWideRaw = localStorage.getItem("isWide_active");
	const isWide = isWideRaw === null ? true : isWideRaw === "true" || isWideRaw === "1";
	const width = Math.floor(screen.availWidth * (2 / 3));
	const videoHeight = isWide ? Math.floor(width / (16 / 9)) : Math.floor(width / (14 / 9));
	const height = videoHeight + 1;
	const left = Math.floor((screen.availWidth - width) / 2);
	const top = Math.floor((screen.availHeight - height) / 2);
	let windowTitle = "Video player - Wrapper offline";
	const res = await fetch( `${apiServer}/api/movie/get_info?id=${encodeURIComponent(movieId)}` );
	if (res.ok) {
		const data = await res.json();
		if (data?.title) { windowTitle = `${data.title} - Wrapper offline`; }
	}
	const features = [ `width=${width}`, `height=${height}`, `left=${left}`, `top=${top}`, "useContentSize=yes", "menubar=no", "status=no", "resizable=no", ].join(",");
	window.open( `?redirect=/movies/play/${movieId}`, windowTitle, features );
}

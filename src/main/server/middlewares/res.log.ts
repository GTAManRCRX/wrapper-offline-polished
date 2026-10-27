let lastLoggedPath = "";

export default async function resLog ( req:Request, res:Response, next:() => Promise<void> ) {
	const currentPath = req.parsedUrl.pathname;
	const isPolling = currentPath.startsWith('/api/asset/upload/progress/');
	const isDuplicate = currentPath === lastLoggedPath;
	if (!isPolling && !isDuplicate) {
		console.log(`${req.method} [${(new Date()).toISOString()}] ${currentPath}`);
		lastLoggedPath = currentPath;
	}
	res.log = (toLog) => {
		if (!isPolling && !isDuplicate) {
			console.log(`${" ".repeat(req.method.length - 2)} * [${(new Date()).toISOString()}] ${toLog}`);
		}
	};
	await next();
};

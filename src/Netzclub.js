/*****************
The caching and display of data is completly based on this project: https://github.com/BergenSoft/scriptable_premiumsim in Version 1.0.5.

credits:
https://github.com/BergenSoft/scriptable_premiumsim
https://github.com/chaeimg/battCircle/blob/main/battLevel.js
*/

// ************************
// * CUSTOM CONFIGURATION *
// ************************
// How many minutes should the cache be used
let m_CacheMinutes = 60 * 4;

// Styles
const m_CanvSize = 200;
const m_CanvTextSize = 16;

const m_CanvFillColorMonth = '#898989';
const m_CanvFillColorDataGood = '#1AE01A';
const m_CanvFillColorDataOK = '#E0E01A';
const m_CanvFillColorDataBad = '#E01A1A';
const m_CanvStrokeColor = '#D3D3D3'; // Circles background color
//const m_CanvBackColor = '#242424';   // Widget background color
//const m_CanvTextColor = '#FFFFFF';   // Text color (use same color as above to hide text)

// Dimensions of the circles
const m_CanvWidth = 9;
const m_CanvRadiusMonth = 80;
const m_CanvRadiusData = 70;


// ********************
// * GLOBAL VARIABLES *
// ********************

// Used to draw the circles
let widget = new ListWidget()
widget.setPadding(14, 14, 14, 14)

let m_Canvas = new DrawContext();
m_Canvas.opaque = false
Script.setWidget(widget);
Script.complete();

const m_forceReload = false;

// For processing the requests
let m_Cookies = { /*"isCookieAllowed": "true"*/ };
let m_SecondCookies = {};
let m_Sid = null;
let m_Csrf_token = null;

// Usage data
let m_Data = {
	bytes: 0,
	percent: 0,
	total: 0,
	lastDay: 0,
};

// Used for comparing caching date and to calculate month progress
const m_Today = new Date();

// Set up the file manager.
const m_Filemanager = initFileManager();

// Set up cache
const m_ConfigRoot = m_Filemanager.joinPath(m_Filemanager.documentsDirectory(), Script.name());
const m_CachePath = m_Filemanager.joinPath(m_ConfigRoot, "cache.json");
console.log("Cache Path: " + m_CachePath);
const m_CacheExists = m_Filemanager.fileExists(m_CachePath)
const m_CacheDate = m_CacheExists ? m_Filemanager.modificationDate(m_CachePath) : 0

// Set up config
const m_ConfigFile = m_Filemanager.joinPath(m_ConfigRoot, "config.json");
if (!m_Filemanager.fileExists(m_ConfigFile)) {
	let alertBox = new Alert();
	alertBox.title = "Zugangsdaten";
	alertBox.message = "Bitte die Zugangsdaten eingeben.\nDie Daten werden standardmäßig in der iCloud abgespeichert.";
	alertBox.addAction("Speichern");
	alertBox.addCancelAction("Abbrechen");
	alertBox.addTextField("Mobilfunknummer oder E-Mail-Adresse");
	alertBox.addSecureTextField("Passwort");
	let pressed = await alertBox.present();
	
	if (pressed === 0) { // Save
		const obj = {
			username: alertBox.textFieldValue(0),
			password: alertBox.textFieldValue(1)
		};
		m_Filemanager.writeString(m_ConfigFile, JSON.stringify(obj));
		await m_Filemanager.downloadFileFromiCloud(m_ConfigFile);
	}
	else {
		throw new Error("No configuration found");
	}
}
else {
	await m_Filemanager.downloadFileFromiCloud(m_ConfigFile);
}

console.log("Config Path: " + m_ConfigFile);

// Retrieve credentials
const config = JSON.parse(await m_Filemanager.readString(m_ConfigFile));
if (config === null) {
	throw new Error("Failed to load configuration. Please delete or correct the file and run the script again.");
}

// Used URLS
let m_LoginPageUrl = "https://www.netzclub.net/login"
let m_DataUsageUrl = "https://www.netzclub.net/selfcare";

try {
	// Reload data if script is running within scriptable app
	if (!config.runsInWidget || !m_CacheExists || (m_Today.getTime() - m_CacheDate.getTime()) > (m_CacheMinutes * 60 * 1000) || !loadDataFromCache()) {
		// Load from website
		await prepareLoginData();
		await getDataUsage();
		saveDataToCache();
	}
}
catch (e) {
	console.error(e);
	// Could not load from website, so load from cache
	loadDataFromCache();
}

await createWidget();
Script.complete();

async function prepareLoginData() {
	// Get login page
	let req;
	req = new Request(m_LoginPageUrl);
	req.method = 'GET';
 	req.headers = {
 		'Cookie': '',
		'Host': 'www.netzclub.net',
 		'Connection': 'close'
 	};

	var resp = await req.loadString();

	appendCookies(req.response.cookies);

	m_Csrf_token = getSubstring(resp, ['_csrf_token', 'value="'], "\"");
	
	console.log('CSRF-Token is');
	console.log(m_Csrf_token);

	// Get PHPSESSID
	m_Sid = m_Cookies["PHPSESSID"];
	
	console.log('FIRST COOKIE is');
	console.log(m_Cookies);
}

async function getDataUsage() {	
	// Post login data
	let req = new Request(m_LoginPageUrl);
	req.method = 'POST';

	req.headers = {
		'Cookie': getCookiesString(),
		'Host': 'www.netzclub.net',
		'Content-type': 'application/x-www-form-urlencoded',
 		'Connection': 'keep-alive'
	};

	req.body = "username=" + config.username + "&current-password=" + config.password + "&anchor=&_csrf_token=" + m_Csrf_token;

	req.onRedirect = function (request) {
		return null;
	}

	var resp = await req.loadString();

	//appendSecondCookies
	req.response.cookies.map(function (v) {
			m_SecondCookies[v.name] = v.value;
			return null;
		});
	
	console.log('SECOND COOKIE is');
	console.log(m_SecondCookies);

	if (req.response.statusCode == 302 && req.response.headers["Location"] == "/selfcare") {
  		let SecondCookieValues = Object.entries(m_SecondCookies).map(function (v) {
			return v[0] + "=" + v[1];
		});

		let SecondCookieString = SecondCookieValues.join('; ');
  		
		req = new Request(m_DataUsageUrl);
		req.method = 'GET';
		req.headers = {
			'Cookie': SecondCookieString,
			'Host': "www.netzclub.net",
			'Connection': 'close'
		};
		resp = await req.loadString();

		let dataValues = getSubstring(resp, ['class="c-simple-progress"', '</progress>'], '</div>').trim().split(' von ');

		let dataUsed = dataValues[1].replace(" MB", "") - dataValues[0].replace(" MB", "");
		let dataInclusive = dataValues[1].replace(" MB", "");

		let dataDate = getSubstring(resp, ['<div class="u-info"', '>'], '</div>').trim().replace("bis ", "");
		
		console.log('Billing till:');
		console.log(dataDate);
		
		console.log('Data Values:');
		console.log(dataValues);

		let dataUsagePercent = Math.round(dataUsed / dataInclusive * 1000) / 10; 

		dataUsageBytes = parseInt(dataUsed);

		m_Data.bytes = dataUsed;
		m_Data.percent = dataUsagePercent;
		m_Data.total = dataInclusive;
		m_Data.lastDay = dataDate;

		console.log('Percentage Used:');
		console.log(dataUsagePercent);
		return;
	}
}

function initFileManager() {
	fileManager = FileManager.iCloud();
	path = fileManager.joinPath(fileManager.documentsDirectory(), Script.name());
	
	if (!fileManager.isDirectory(path))
		fileManager.createDirectory(path);

	return fileManager;
}

function getCookiesString() {
	let CookieValues = Object.entries(m_Cookies).map(function (v) {
		return v[0] + "=" + v[1];
	});

	result = CookieValues.join('; ');

	return result;
}

function appendCookies(newCookies) {
	newCookies.map(function (v) {
		m_Cookies[v.name] = v.value;
		return null;
	});
}

function getSubstring(input, lookfor, lookUntil) {
	lookfor.forEach(look => {
		input = input.substr(input.indexOf(look) + look.length);
	});

	return input.substr(0, input.indexOf(lookUntil));
}

function saveDataToCache() {
	try {
		m_Filemanager.writeString(m_CachePath, JSON.stringify(m_Data))
		return true;
	}
	catch (e) {
		console.warn("Could not create the cache file.")
		console.warn(e)
		return false;
	}
}

function loadDataFromCache() {
	try {
		m_Data = JSON.parse(m_Filemanager.readString(m_CachePath));
		return true;
	}
	catch (e) {
		console.warn("Could not load the cache file.")
		console.warn(e)
		return false;
	}
}

async function createWidget() {
	m_Canvas.size = new Size(m_CanvSize, m_CanvSize);
	m_Canvas.respectScreenScale = true;

	dataDate = m_Data.lastDay.split('.');
	const lastDay = new Date(dataDate[2] + '-' + dataDate[1] + '-' + dataDate[0]);
	const firstDay = new Date(lastDay.getTime() - (60*60*24*4*7*1000)); // Netzclub "bills" every 4 weeks

	const percentMonth = (m_Today.getTime() - firstDay.getTime()) / (lastDay.getTime() - firstDay.getTime());
	const fillColorData = (m_Data.percent / 100 <= percentMonth) ? m_CanvFillColorDataGood : ((m_Data.percent / 100 / 1.1 <= percentMonth) ? m_CanvFillColorDataOK : m_CanvFillColorDataBad);

	drawArc(
		new Point(m_CanvSize / 2, m_CanvSize / 2),
		m_CanvRadiusMonth,
		m_CanvWidth,
		percentMonth * 100 * 3.6,
		m_CanvFillColorMonth
	);
	drawArc(
		new Point(m_CanvSize / 2, m_CanvSize / 2),
		m_CanvRadiusData,
		m_CanvWidth,
		m_Data.percent * 3.6,
		fillColorData
	);
    
    let stack = widget.addStack()
	stack.centerAlignContent() 
	stack.layoutVertically() 
	
	let dataStack = stack.addStack()
	dataStack.layoutHorizontally()
	dataStack.addSpacer()

    let dataText = dataStack.addText(`${(m_Data.bytes).toFixed(0)} / ${m_Data.total} MB`)
    dataText.font = Font.semiboldRoundedSystemFont(13)
    dataText.textColor = Color.dynamic(Color.black(), Color.white())
    dataText.centerAlignText();
	dataStack.addSpacer()

	stack.addSpacer(3)

	dataStack = stack.addStack()
	dataStack.layoutHorizontally()
	dataStack.addSpacer()

	let percentageText = dataStack.addText(`${m_Data.percent} %`)
    percentageText.font = Font.semiboldRoundedSystemFont(17)
    percentageText.textColor = Color.dynamic(Color.black(), Color.white())
	percentageText.centerAlignText()
	dataStack.addSpacer()

	const canvImage = m_Canvas.getImage();
	widget.backgroundImage = canvImage;

	await widget.presentSmall();
}


function sinDeg(deg) {
	return Math.sin((deg * Math.PI) / 180);
}

function cosDeg(deg) {
	return Math.cos((deg * Math.PI) / 180);
}

function drawArc(ctr, rad, w, deg, fillColor) {
	let bgx = ctr.x - rad;
	let bgy = ctr.y - rad;
	let bgd = 2 * rad;
	let bgr = new Rect(bgx, bgy, bgd, bgd);

	m_Canvas.setFillColor(new Color(fillColor));
	m_Canvas.setStrokeColor(new Color(m_CanvStrokeColor));
	m_Canvas.setLineWidth(w);
	m_Canvas.strokeEllipse(bgr);

	for (t = 0; t < deg; t++)
	{
		rect_x = ctr.x + rad * sinDeg(t) - w / 2;
		rect_y = ctr.y - rad * cosDeg(t) - w / 2;
		rect_r = new Rect(rect_x, rect_y, w, w);
		m_Canvas.fillEllipse(rect_r);
	}
}

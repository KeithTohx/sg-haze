const W = 1000, H = 750;
const wrapper = document.getElementById('map');
const svg = d3.select('#svg');
const contents = {};
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var psi_values = {};
var pm25_values = {};

// Which planning areas belong to which region
const REGIONS = {
  'CENTRAL': { color: '#fde68a', areas: [
    'BISHAN', 'BUKIT TIMAH', 'GEYLANG', 'KALLANG', 'MARINE PARADE', 'NEWTON',
    'NOVENA', 'ORCHARD', 'RIVER VALLEY', 'ROCHOR', 'TANGLIN', 'TOA PAYOH'] },
  'SOUTH': { color: '#fbcfe8', areas: [
    'BUKIT MERAH', 'DOWNTOWN CORE', 'MARINA EAST', 'MARINA SOUTH', 'MUSEUM',
    'OUTRAM', 'QUEENSTOWN', 'SINGAPORE RIVER', 'SOUTHERN ISLANDS', 'STRAITS VIEW'] },
  'EAST': { color: '#bbf7d0', areas: [
    'BEDOK', 'CHANGI', 'CHANGI BAY', 'PASIR RIS', 'PAYA LEBAR', 'TAMPINES'] },
  'NORTH': { color: '#bfdbfe', areas: [
    'CENTRAL WATER CATCHMENT', 'LIM CHU KANG', 'MANDAI', 'SEMBAWANG', 'SIMPANG',
    'SUNGEI KADUT', 'WOODLANDS', 'YISHUN', 'ANG MO KIO', 'HOUGANG', 'PUNGGOL', 
    'SELETAR', 'SENGKANG', 'SERANGOON'] },
  'WEST': { color: '#fed7aa', areas: [
    'BOON LAY', 'BUKIT BATOK', 'BUKIT PANJANG', 'CHOA CHU KANG', 'CLEMENTI',
    'JURONG EAST', 'JURONG WEST', 'PIONEER', 'TENGAH', 'TUAS', 'WESTERN ISLANDS',
    'WESTERN WATER CATCHMENT'] },
};

// Islands would drag the box position away from the mainland, so skip them
const IGNORE_FOR_CENTRE = ['SOUTHERN ISLANDS', 'WESTERN ISLANDS', 'NORTH-EASTERN ISLANDS'];

// Box offsets from the computed centre, in % of map width (x) and height (y).
// +x moves right, +y moves down.
const nudge = {
  'NORTH':      { x: 2,  y: -12 },   // up, away from the centre of the island
  'EAST':       { x: 3,  y: -2  },   // right and down, towards Changi
  'WEST':       { x: -1, y: -4.5  },   // left, out into Jurong
  'CENTRAL':    { x: -2,  y: -9 },   // up, so it doesn't sit on South
  'SOUTH':      { x: 3.5,  y: 6  },   // down, towards the southern coast
};

// Build area name -> region lookup
const areaToRegion = {};
for (const [region, cfg] of Object.entries(REGIONS)) {
    cfg.areas.forEach(a => (areaToRegion[a] = region));
}


const RETRY_DELAY_MS = 10000; // 10 seconds
const MIN_RECHECK_MS = 5 * 60 * 1000; // while waiting for new data, check at most every 5 min

// Reading time of the first item in the response, as milliseconds
function dataTimestamp(response) {
    try {
        return new Date(response.data.items[0].timestamp).getTime();
    } catch (e) {
        return 0; // unexpected shape, treat as stale
    }
}

function cachedAjax(key, settings) {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(key)); } catch (e) {}

    if (cached) {
        // Start of the current clock hour (Singapore is UTC+8, a whole-hour offset,
        // so this is the same moment as the SGT hour start in any timezone)
        const hourStart = Math.floor(Date.now() / 3600000) * 3600000;

        const hasLatest = dataTimestamp(cached.data) >= hourStart;
        const checkedRecently = Date.now() - cached.fetchedAt < MIN_RECHECK_MS;

        if (hasLatest || checkedRecently) {
            return Promise.resolve(cached.data);
        }
    }

    return ajaxWithRetry(settings)
        .then(data => {
            try {
                localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), data }));
            } catch (e) {}
            return data;
        })
        .catch(err => {
            if (cached) {
                console.warn(`Using stale cache for ${key}`);
                try {
                    localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), data: cached.data }));
                } catch (e) {}
                return cached.data;
            }
            throw err;
        });
};


function ajaxWithRetry(settings) {
    return new Promise((resolve, reject) => {
        $.ajax(settings)
            .done(resolve)
            .fail((xhr) => {
                if (xhr.status === 429) {
                    console.warn(`Rate limited (429). Retrying in 10s...`);
                    setTimeout(() => {
                        ajaxWithRetry(settings).then(resolve).catch(reject);
                    }, RETRY_DELAY_MS);
                } else {
                    reject(xhr);
                }
            });
    });
}


/* --- Pollutant Standards Index (PSI) --- */
var settings_psi = {
    "url": "https://api-open.data.gov.sg/v2/real-time/api/psi",
    "method": "GET",
    "timeout": 0,
};
/* --- PM2.5 --- */
var settings_pm25 = {
    "url": "https://api-open.data.gov.sg/v2/real-time/api/pm25",
    "method": "GET",
    "timeout": 0,
};

$("#overview_title").html("Loading information...");
$("#subtitle").html("Loading information...");


// Load data from API
cachedAjax('pm25', settings_pm25)
    .then(function (response) {
        pm25_values = response;
        return cachedAjax('psi', settings_psi);
    })
    .then(function (response) {
        psi_values = response;
        return fetch('resources/MasterPlan2019PlanningAreaBoundaryNoSea.geojson');
    })
    .then(r => r.json())
    .then(draw)
    .catch(err => console.error("Failed to load data:", err));
    


function draw(geo) {
    getTimestamp();
    getOverview();
    displayAdvisory();
    displayRemarks();

    const projection = d3.geoIdentity().reflectY(true).fitSize([W, H], geo);
    const path = d3.geoPath(projection);

    // 1. Draw every planning area, coloured by its region
    svg.selectAll('path')
        .data(geo.features)
        .join('path')
        .attr('class', 'area')
        .attr('d', path)
        .append('title');
        // .text(f => `${getArea(f)} (${areaToRegion[getArea(f)] || 'unassigned'})`);

    // 2. One box per region, placed at the centre of its planning areas
    for (const [region, cfg] of Object.entries(REGIONS)) {
        const group = {
            type: 'FeatureCollection',
            features: geo.features.filter(f => {
                const a = getArea(f);
                return cfg.areas.includes(a) && !IGNORE_FOR_CENTRE.includes(a);
            }),
        };
        const [cx, cy] = path.centroid(group);
        const n = nudge[region] || { x: 0, y: 0 };

        const box = document.createElement('div');
        box.className = 'region-box';
        box.dataset.region = region;
        box.style.left = (cx / W * 100 + n.x) + '%';
        box.style.top  = (cy / H * 100 + n.y) + '%';
        box.innerHTML = `<p>${region}</p><div class="content"></div>`;
        wrapper.appendChild(box);
        contents[region] = box.querySelector('.content');
    }

    const psi_24hr = document.getElementById("psi_24hr");
    const pm25_1hr = document.getElementById("pm25_1hr");
    pm25_1hr.style.background = "#cbd5e1";
    $("#subtitle").html("Current Air Quality");
    $("#descriptor").html(`
                <table class="center">
                    <tr>
                        <td style="text-align: right;">µg/m&sup3</td>
                        <td style="color: green;">0 - 55</td>
                        <td style="color: rgb(240, 180, 0);">56 - 150</td>
                        <td style="color: darkorange;">151 - 250</td>
                        <td style="color: red;">Above 250</td>
                    </tr>
                    <tr>
                        <td style="text-align: right;">Descriptor</td>
                        <td style="color: green;">Normal</td>
                        <td style="color: rgb(240, 180, 0);">Elevated</td>
                        <td style="color: darkorange;">High</td>
                        <td style="color: red;">Very High</td>
                    </tr>
                </table>`);
    getPM25Value();

    pm25_1hr.addEventListener("click", function(){
        psi_24hr.style.background = "#fff";
        pm25_1hr.style.background = "#cbd5e1";
        $("#subtitle").html("Current Air Quality");
        $("#descriptor").html(`
                    <table class="center">
                        <tr>
                            <td style="text-align: right;">µg/m&sup3</td>
                            <td style="color: green;">0 - 55</td>
                            <td style="color: rgb(240, 180, 0);">56 - 150</td>
                            <td style="color: darkorange;">151 - 250</td>
                            <td style="color: red;">Above 250</td>
                        </tr>
                        <tr>
                            <td style="text-align: right;">Descriptor</td>
                            <td style="color: green;">Normal</td>
                            <td style="color: rgb(240, 180, 0);">Elevated</td>
                            <td style="color: darkorange;">High</td>
                            <td style="color: red;">Very High</td>
                        </tr>
                    </table>`);
        getPM25Value();
    });

    psi_24hr.addEventListener("click", function(){
        pm25_1hr.style.background = "#fff";
        psi_24hr.style.background = "#cbd5e1";
        $("#subtitle").html("Air Quality Over The Past 24 Hours");
        $("#descriptor").html(`
                    <table class="center">
                        <tr>
                            <td style="text-align: right;">PSI Value</td>
                            <td style="color: green;">0 - 100</td>
                            <td style="color: rgb(240, 180, 0);">101 - 200</td>
                            <td style="color: darkorange;">201 - 300</td>
                            <td style="color: red;">Above 300</td>
                        </tr>
                        <tr>
                            <td style="text-align: right;">Air Quality</td>
                            <td style="color: green;">Good to Moderate</td>
                            <td style="color: rgb(240, 180, 0);">Unhealthy</td>
                            <td style="color: darkorange;">Very Unhealthy</td>
                            <td style="color: red;">Hazardous</td>
                        </tr>
                    </table>`);
        getPSIValue();
    });

}

// Name of a planning area; handles both property layouts
function getArea(f) {
    const p = f.properties;
    if (p.PLN_AREA_N) return p.PLN_AREA_N.toUpperCase();
    const m = /<th>PLN_AREA_N<\/th>\s*<td>(.*?)<\/td>/i.exec(p.Description || '');
    return m ? m[1].toUpperCase() : '';
}

function addData(region, text, colour, element) {
    const line = document.createElement(element);
    line.textContent = text;
    line.style.color = colour;
    if (contents[region].children.length >= 2) {
        while (contents[region].hasChildNodes())
            contents[region].removeChild(contents[region].firstChild);
    }
    if (contents[region].children.length < 2)
        contents[region].appendChild(line);
}

function displayAdvisory() {
    $("#advisory").html(`
        <p style="font-size: 0.8em;">For immediate outdoor activities (1-hr PM2.5):</p>
        <table>
            <tr>
                <td style="color: green; width: 1%; white-space: nowrap;">Normal<br>(0 - 55 µg/m&sup3)</td>
                <td>CONTINUE with normal activities</td>
            </tr>
            <tr>
                <td style="color: rgb(240, 180, 0); width: 1%; white-space: nowrap;">Elevated<br>(56 - 150 µg/m&sup3)</td>
                <td>
                    <p><i>Healthy persons: </i><br>REDUCE strenuous outdoor activities for the next hour</p> 
                    <p><i>Vulnerable persons: </i><br>AVOID strenuous outdoor activities for the next hour</p> 
                </td>
            </tr>
            <tr>
                <td style="color: darkorange; width: 1%; white-space: nowrap;">High<br>(150 - 250 µg/m&sup3)</td>
                <td>
                    <p><i>Healthy persons: </i><br>AVOID strenuous outdoor activities for the next hour</p> 
                    <p><i>Vulnerable persons: </i><br>AVOID all outdoor activities for the next hour; May wear a mask to reduce exposure</p> 
                </td>
            </tr>
            <tr>
                <td style="color: red; width: 1%; white-space: nowrap;">Very High<br>(Above 250 µg/m&sup3)</td>
                <td>
                    <p><i>Healthy persons: </i><br>MINIMISE all outdoor activities for the next hour</p> 
                    <p><i>Vulnerable persons: </i><br>AVOID all outdoor activities for the next hour; May wear a mask to reduce exposure</p> 
                </td>
            </tr>
        </table>
        <p style="font-size: 0.7em;color: gray;">Vulnerable persons include the elderly, pregnant women, children, and persons with chronic lung disease or heart disease.</p>
        `);
}

function displayRemarks() {
    $("#remarks").html(`
        Remarks:
        <ul>
        <li>The air quality readings are retrieved from NEA via data.gov.sg</li>
        <li>The air quality descriptor provided in the overview is based on the highest 1-hr PM2.5 reading among the five regions. 
        Refer to the individual regions for region-specific readings and descriptors.</li>
        <li>The health advisory follows the NEA guide for immediate outdoor activities. 
        It is not intended to be prescriptive. Refer to the latest 1-hr PM2.5 readings before proceeding with activities planned within the next few hours.</li>
        </ul>`);
}

function getTimestamp() {
    var timestamp = (pm25_values.data.items[0].timestamp).split("T");
    $("#title_time").html("As at " + formatTime(timestamp[1]) + ", " + formatDate(timestamp[0]));
}

function getOverview() {
    var pm25_north = pm25_values.data.items[0].readings.pm25_one_hourly.north
    var pm25_south = pm25_values.data.items[0].readings.pm25_one_hourly.south
    var pm25_east = pm25_values.data.items[0].readings.pm25_one_hourly.east
    var pm25_west = pm25_values.data.items[0].readings.pm25_one_hourly.west
    var pm25_central = pm25_values.data.items[0].readings.pm25_one_hourly.central

    var pm25 = [pm25_north, pm25_south, pm25_east, pm25_west, pm25_central]
    var pm25_max = Math.max(...pm25)
    var pm25_min = Math.min(...pm25)
    var pm25_max_desc = getPM25Descriptor(pm25_max)

    var psi_north = psi_values.data.items[0].readings.psi_twenty_four_hourly.north
    var psi_south = psi_values.data.items[0].readings.psi_twenty_four_hourly.south
    var psi_east = psi_values.data.items[0].readings.psi_twenty_four_hourly.east
    var psi_west = psi_values.data.items[0].readings.psi_twenty_four_hourly.west
    var psi_central = psi_values.data.items[0].readings.psi_twenty_four_hourly.central

    var psi = [psi_north, psi_south, psi_east, psi_west, psi_central]
    var psi_max = Math.max(...psi)
    var psi_min = Math.min(...psi)

    $("#overview_title").html("Today's Air Quality Overview");
    $("#overview").html(`
        <div class="flex-container">
            <div>
                <p>1-hr PM2.5 (µg/m&sup3)</p>
                <h3 id="pm25_min">` + pm25_min + `</h3><h3>-</h3><h3 id="pm25_max">` + pm25_max + `</h3>
                <h3 id="pm25_max_desc" class="pill">` + pm25_max_desc + `</h3>
            </div>
            <div>
                <p>24-hr PSI</p>
                <h3 id="psi_min">` + psi_min + `</h3><h3>-</h3><h3 id="psi_max">` + psi_max + `</h3>
            </div>
        </div>`);

    $("#pm25_max_desc").css('background', getPM25Colour(pm25_max))
    $("#pm25_min").css('color', getPM25Colour(pm25_min));
    $("#pm25_max").css('color', getPM25Colour(pm25_max));
    $("#psi_min").css('color', getPSIColour(psi_min));
    $("#psi_max").css('color', getPSIColour(psi_max));

}

function getPSIValue() {

    var psi_north = psi_values.data.items[0].readings.psi_twenty_four_hourly.north
    var psi_south = psi_values.data.items[0].readings.psi_twenty_four_hourly.south
    var psi_east = psi_values.data.items[0].readings.psi_twenty_four_hourly.east
    var psi_west = psi_values.data.items[0].readings.psi_twenty_four_hourly.west
    var psi_central = psi_values.data.items[0].readings.psi_twenty_four_hourly.central

    addData('NORTH', psi_north, getPSIColour(psi_north), 'h4');
    addData('SOUTH', psi_south, getPSIColour(psi_south), 'h4');
    addData('EAST', psi_east, getPSIColour(psi_east), 'h4');
    addData('WEST', psi_west, getPSIColour(psi_west), 'h4');
    addData('CENTRAL', psi_central, getPSIColour(psi_central), 'h4');

    addData('NORTH', '('+ getPSIDescriptor(psi_north) +')', getPSIColour(psi_north), 'p');
    addData('SOUTH', '('+ getPSIDescriptor(psi_south) +')', getPSIColour(psi_south), 'p');
    addData('EAST', '('+ getPSIDescriptor(psi_east) +')', getPSIColour(psi_east), 'p');
    addData('WEST', '('+ getPSIDescriptor(psi_west) +')', getPSIColour(psi_west), 'p');
    addData('CENTRAL', '('+ getPSIDescriptor(psi_central) +')', getPSIColour(psi_central), 'p');

}
function getPSIColour(psi_value) {
    if (psi_value <= 100)
        return "green";
    else if (psi_value <= 200)
        return "rgb(240, 180, 0)";
    else if (psi_value <= 300)
        return "darkorange";
    else return "red";
}
function getPSIDescriptor(psi_value) {
    if (psi_value <= 100)
        return "Good to Moderate";
    else if (psi_value <= 200)
        return "Unhealthy";
    else if (psi_value <= 300)
        return "Very Unhealthy";
    else return "Hazardous";
}

function getPM25Value() {

    var pm25_north = pm25_values.data.items[0].readings.pm25_one_hourly.north
    var pm25_south = pm25_values.data.items[0].readings.pm25_one_hourly.south
    var pm25_east = pm25_values.data.items[0].readings.pm25_one_hourly.east
    var pm25_west = pm25_values.data.items[0].readings.pm25_one_hourly.west
    var pm25_central = pm25_values.data.items[0].readings.pm25_one_hourly.central

    addData('NORTH', pm25_north, getPM25Colour(pm25_north), 'h4');
    addData('SOUTH', pm25_south, getPM25Colour(pm25_south), 'h4');
    addData('EAST', pm25_east, getPM25Colour(pm25_east), 'h4');
    addData('WEST', pm25_west, getPM25Colour(pm25_west), 'h4');
    addData('CENTRAL', pm25_central, getPM25Colour(pm25_central), 'h4');

    addData('NORTH', '('+ getPM25Descriptor(pm25_north) +')', getPM25Colour(pm25_north), 'p');
    addData('SOUTH', '('+ getPM25Descriptor(pm25_south) +')', getPM25Colour(pm25_south), 'p');
    addData('EAST', '('+ getPM25Descriptor(pm25_east) +')', getPM25Colour(pm25_east), 'p');
    addData('WEST', '('+ getPM25Descriptor(pm25_west) +')', getPM25Colour(pm25_west), 'p');
    addData('CENTRAL', '('+ getPM25Descriptor(pm25_central) +')', getPM25Colour(pm25_central), 'p');

}
function getPM25Colour(pm25_value) {
    if (pm25_value <= 55)
        return "green"
    else if (pm25_value <= 150)
        return "rgb(240, 180, 0)"
    else if (pm25_value <= 250)
        return "darkorange"
    else return "red"
}
function getPM25Descriptor(pm25_value) {
    if (pm25_value <= 55)
        return "Normal"
    else if (pm25_value <= 150)
        return "Elevated"
    else if (pm25_value <= 250)
        return "High"
    else return "Very High"
}

function formatTime(psi_time) {
    var values = psi_time.split(":"); // 16:30:34+08:00
    var hour = values[0];
    if (hour == "00") return "12am";
    else if (hour < 12) {
        if (hour.charAt(0) == "0") return hour.charAt(1) + "am";
        else return hour + "am";
    }
    else if (hour == 12)
        return hour + "pm";
    else 
        return (hour % 12) + "pm"; 
}
function formatDate(psi_date) {
    var values = psi_date.split("-"); // 2026-10-17
    return values[2] + " " + months[values[1]-1] + " " + values[0];
}


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
    'SUNGEI KADUT', 'WOODLANDS', 'YISHUN'] },
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
  'NORTH':      { x: 8,  y: -8 },   // up, away from the centre of the island
  'EAST':       { x: 5,  y: -2  },   // right and down, towards Changi
  'WEST':       { x: -1, y: -5  },   // left, out into Jurong
  'CENTRAL':    { x: -2,  y: -9 },   // up, so it doesn't sit on South
  'SOUTH':      { x: 4,  y: 6  },   // down, towards the southern coast
};

// Build area name -> region lookup
const areaToRegion = {};
for (const [region, cfg] of Object.entries(REGIONS)) {
    cfg.areas.forEach(a => (areaToRegion[a] = region));
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

// Load data from API 
$.ajax(settings_pm25).done(function (response) {
    pm25_values = response;

    $.ajax(settings_psi).done(function (response) {
        psi_values = response;

        fetch('resources/MasterPlan2019PlanningAreaBoundaryNoSea.geojson')                       
            .then(r => r.json())
            .then(draw);

    });
});
    


function draw(geo) {

    const projection = d3.geoIdentity().reflectY(true).fitSize([W, H], geo);
    const path = d3.geoPath(projection);

    // 1. Draw every planning area, coloured by its region
    svg.selectAll('path')
        .data(geo.features)
        .join('path')
        .attr('class', 'area')
        .attr('d', path)
        .append('title')
        .text(f => `${getArea(f)} (${areaToRegion[getArea(f)] || 'unassigned'})`);

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

    getTimestamp();
    const psi_24hr = document.getElementById("psi_24hr");
    const pm25_1hr = document.getElementById("pm25_1hr");
    pm25_1hr.style.background = "#cbd5e1";
    $("#message").html("Current Air Quality");
    $("#descriptor").html(`
                <table class="center">
                    <tr>
                        <td>µg/m&sup3</td>
                        <td style="color: green;">0 - 55</td>
                        <td style="color: rgb(238, 190, 0);">56 - 150</td>
                        <td style="color: darkorange;">151 - 250</td>
                        <td style="color: red;">Above 250</td>
                    </tr>
                    <tr>
                        <td>Descriptor</td>
                        <td style="color: green;">Normal</td>
                        <td style="color: rgb(238, 190, 0);">Elevated</td>
                        <td style="color: darkorange;">High</td>
                        <td style="color: red;">Very High</td>
                    </tr>
                </table>`);
    getPM25Value();

    pm25_1hr.addEventListener("click", function(){
        psi_24hr.style.background = "#fff";
        pm25_1hr.style.background = "#cbd5e1";
        $("#message").html("Current Air Quality");
        $("#descriptor").html(`
                    <table class="center">
                        <tr>
                            <td>µg/m&sup3</td>
                            <td style="color: green;">0 - 55</td>
                            <td style="color: rgb(238, 190, 0);">56 - 150</td>
                            <td style="color: darkorange;">151 - 250</td>
                            <td style="color: red;">Above 250</td>
                        </tr>
                        <tr>
                            <td>Descriptor</td>
                            <td style="color: green;">Normal</td>
                            <td style="color: rgb(238, 190, 0);">Elevated</td>
                            <td style="color: darkorange;">High</td>
                            <td style="color: red;">Very High</td>
                        </tr>
                    </table>`);
        getPM25Value();
    });

    psi_24hr.addEventListener("click", function(){
        pm25_1hr.style.background = "#fff";
        psi_24hr.style.background = "#cbd5e1";
        $("#message").html("Air Quality Over The Past 24 Hours");
        $("#descriptor").html(`
                    <table class="center">
                        <tr>
                            <td>PSI Value</td>
                            <td style="color: green;">0 - 100</td>
                            <td style="color: rgb(238, 190, 0);">101 - 200</td>
                            <td style="color: darkorange;">201 - 300</td>
                            <td style="color: red;">Above 300</td>
                        </tr>
                        <tr>
                            <td>Air Quality</td>
                            <td style="color: green;">Good to Moderate</td>
                            <td style="color: rgb(238, 190, 0);">Unhealthy</td>
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

function getTimestamp() {
    var updatedTimestamp = (pm25_values.data.items[0].updatedTimestamp).split("T");
    $("#title_time").html("As at " + formatTime(updatedTimestamp[1]) + ", " + formatDate(updatedTimestamp[0]));
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

    addData('NORTH', getPSIDescriptor(psi_north), getPSIColour(psi_north), 'p');
    addData('SOUTH', getPSIDescriptor(psi_south), getPSIColour(psi_south), 'p');
    addData('EAST', getPSIDescriptor(psi_east), getPSIColour(psi_east), 'p');
    addData('WEST', getPSIDescriptor(psi_west), getPSIColour(psi_west), 'p');
    addData('CENTRAL', getPSIDescriptor(psi_central), getPSIColour(psi_central), 'p');

}
function getPSIColour(psi_value) {
    if (psi_value <= 100)
        return "green";
    else if (psi_value <= 200)
        return "rgb(238, 190, 0)";
    else if (psi_value <= 300)
        return "darkorange";
    else return "red";
}
function getPSIDescriptor(psi_value) {
    if (psi_value <= 100)
        return "(Good to Moderate)";
    else if (psi_value <= 200)
        return "(Unhealthy)";
    else if (psi_value <= 300)
        return "(Very Unhealthy)";
    else return "(Hazardous)";
}

function getPM25Value() {

    var pm25_west = pm25_values.data.items[0].readings.pm25_one_hourly.west
    var pm25_east = pm25_values.data.items[0].readings.pm25_one_hourly.east
    var pm25_central = pm25_values.data.items[0].readings.pm25_one_hourly.central
    var pm25_south = pm25_values.data.items[0].readings.pm25_one_hourly.south
    var pm25_north = pm25_values.data.items[0].readings.pm25_one_hourly.north

    addData('NORTH', pm25_north, getPM25Colour(pm25_north), 'h4');
    addData('SOUTH', pm25_south, getPM25Colour(pm25_south), 'h4');
    addData('EAST', pm25_east, getPM25Colour(pm25_east), 'h4');
    addData('WEST', pm25_west, getPM25Colour(pm25_west), 'h4');
    addData('CENTRAL', pm25_central, getPM25Colour(pm25_central), 'h4');

    addData('NORTH', getPM25Descriptor(pm25_north), getPM25Colour(pm25_north), 'p');
    addData('SOUTH', getPM25Descriptor(pm25_south), getPM25Colour(pm25_south), 'p');
    addData('EAST', getPM25Descriptor(pm25_east), getPM25Colour(pm25_east), 'p');
    addData('WEST', getPM25Descriptor(pm25_west), getPM25Colour(pm25_west), 'p');
    addData('CENTRAL', getPM25Descriptor(pm25_central), getPM25Colour(pm25_central), 'p');

}
function getPM25Colour(pm25_value) {
    if (pm25_value <= 55)
        return "green"
    else if (pm25_value <= 150)
        return "rgb(238, 190, 0)"
    else if (pm25_value <= 250)
        return "darkorange"
    else return "red"
}
function getPM25Descriptor(pm25_value) {
    if (pm25_value <= 55)
        return "(Normal)"
    else if (pm25_value <= 150)
        return "(Elevated)"
    else if (pm25_value <= 250)
        return "(High)"
    else return "(Very High)"
}

function formatTime(psi_time) {
    var values = psi_time.split(":"); // 16:30:34+08:00
    var hour = values[0];
    if (hour == "00") return "12am";
    else if (hour < 12) 
        return hour + "am";
    else if (hour == 12)
        return hour + "pm";
    else 
        return (hour % 12) + "pm"; 
}
function formatDate(psi_date) {
    var values = psi_date.split("-"); // 2026-10-17
    return values[2] + " " + months[values[1]-1] + " " + values[0];
}


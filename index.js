const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const maxmind = require('maxmind');
const requestIp = require('request-ip');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

mongoose.connect('mongodb+srv://passwordisSArthak:passwordisSArthak@cluster0.b8muydt.mongodb.net/?retryWrites=true&w=majority');

const analyticsSchema = new mongoose.Schema({
    timestamp: { type: Date, required: true },
    referrer: { type: String, required: true },
    screenWidth: { type: Number, required: true },
    isPWA: { type: Boolean, required: true },
    navigationData: { type: Map, of: Number, required: true },
    country: { type: String, required: true },
    anonymousId: { type: String, required: true },
    browserInfo: { type: String, required: true },
});

const Analytics = mongoose.model('Analytics', analyticsSchema);

app.use(cors());
app.use(bodyParser.json());
app.use(requestIp.mw());

let lookup;
maxmind.open('./GeoLite2-Country.mmdb')
    .then(cityLookup => {
        lookup = cityLookup;
    })
    .catch(err => {
        console.error('Error opening GeoLite2 database:', err);
    });

function generateAnonymousId(ip, userAgent, date) {
    const hash = crypto.createHash('sha256');
    hash.update(ip + userAgent + date);
    return hash.digest('hex');
}

app.post('/analytics', async (req, res) => {
    try {
        const clientIp = req.clientIp;
        if (!clientIp) {
            throw new Error('Client IP not found');
        }

        let country = 'unknown';
        if (lookup) {
            const geo = lookup.get(clientIp);
            if (geo && geo.country) {
                country = geo.country.iso_code;
            }
        } else {
            console.error('GeoLite2 lookup not initialized');
        }

        const { timestamp, referrer, screenWidth, isPWA, navigationData, browserInfo } = req.body;
        const date = new Date().toISOString().split('T')[0];
        const anonymousId = generateAnonymousId(clientIp, browserInfo, date);

        const newAnalytics = new Analytics({
            timestamp,
            referrer,
            screenWidth,
            isPWA,
            navigationData,
            country,
            anonymousId,
            browserInfo,
        });

        await newAnalytics.save();
        res.status(201).json(newAnalytics);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

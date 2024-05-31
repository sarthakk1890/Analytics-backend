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

mongoose.connect("mongodb+srv://passwordisSArthak:passwordisSArthak@cluster0.b8muydt.mongodb.net/analytics?retryWrites=true&w=majority", {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Connected to the MongoDB database');
}).catch((error) => {
    console.error('Error connecting to the database', error);
});

function getSubdomain(hostname) {
    const parts = hostname.split('.');
    if (parts.length > 2) {
        return parts.slice(0, -2).join('.');
    }
    return null; // or return 'www' if you want to consider 'www' as a subdomain
}

app.use((req, res, next) => {
    req.subdomain = getSubdomain(req.hostname);
    console.log(`Subdomain: ${req.subdomain}`);
    next();
});


const analyticsSchema = new mongoose.Schema({
    timestamp: { type: Date, required: true },
    referrer: { type: String, required: false },
    screenWidth: { type: Number, required: true },
    isPWA: { type: Boolean, required: true },
    navigationData: { type: Object, required: true },
    country: { type: String, required: true },
    anonymousId: { type: String, required: true },
    browserInfo: { type: String, required: true },
});

const countrySchema = new mongoose.Schema({
    countries: {
        type: Map,
        of: Number
    }
});

const InteractionPerpageSchema = new mongoose.Schema({
    page: { type: String, required: true },
    interactionTime: { type: Number, required: true }
});

const uniqueUserSchema = new mongoose.Schema({
    ip: { type: String, required: true },
    visitDate: { type: Date, required: true }
});


const Analytics = mongoose.model('Analytics', analyticsSchema);
const Country = mongoose.model('Country', countrySchema);
const InteractionPerpage = mongoose.model('InteractionPerpage', InteractionPerpageSchema);
const UniqueUser = mongoose.model('UniqueUser', uniqueUserSchema);

app.use(cors({
    origin: 'https://spectacular-genie-81e9f6.netlify.app/',
    credentials: true
}));
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

Country.findOne().then(doc => {
    if (!doc) {
        const initialCountries = new Country({ countries: {} });
        initialCountries.save().then(() => console.log('Initialized countries document'));
    }
});

app.post('/analytics', async (req, res) => {
    try {
        console.log('Request Body:', req.body);

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

        for (const [page, interactionTime] of Object.entries(navigationData)) {
            await InteractionPerpage.findOneAndUpdate(
                { page },
                { $inc: { interactionTime } },
                { upsert: true }
            );
        }

        const existingUser = await UniqueUser.findOne({ ip: clientIp });
        if (!existingUser) {
            const newUser = new UniqueUser({ ip: clientIp, visitDate: timestamp });
            await newUser.save();
        }

        await Country.findOneAndUpdate(
            {},
            { $inc: { [`countries.${country}`]: 1 } },
            { new: true, upsert: true }
        );

        res.status(201).json(newAnalytics);
    } catch (error) {
        console.error('Error in /analytics route:', error);
        res.status(400).json({ error: error.message });
    }
});

app.get('/users-by-country', async (req, res) => {
    try {
        const countryData = await Country.findOne();

        if (!countryData) {
            return res.status(200).json({ countries: {} });
        }

        const countries = countryData.countries;

        res.status(200).json({ countries });
    } catch (error) {
        console.error('Error in /users-by-country route:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/total-users', async (req, res) => {
    try {
        const totalUsers = await UniqueUser.countDocuments().lean();

        const uniqueDates = await UniqueUser.aggregate([
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$visitDate' } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        const dates = uniqueDates.map(doc => doc._id);
        const userCounts = uniqueDates.map(doc => doc.count);

        const usersPerDate = uniqueDates.map(doc => ({
            date: doc._id,
            userVisited: doc.count
        }));

        const response = {
            totalUsers,
            usersPerDate
        };

        res.status(200).json(response);
    } catch (error) {
        console.error('Error in /total-users route:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.get('/interactions-per-page', async (req, res) => {
    try {
        const interactionsData = await InteractionPerpage.find();

        if (!interactionsData || interactionsData.length === 0) {
            return res.status(200).json({ interactions: [] });
        }

        const interactions = interactionsData.map(interaction => ({
            page: interaction.page,
            interactionTime: interaction.interactionTime
        }));

        res.status(200).json({ interactions });
    } catch (error) {
        console.error('Error in /interactions-per-page route:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});




app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

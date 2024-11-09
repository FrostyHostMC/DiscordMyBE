const RPC = require('discord-rpc');
const clientId = '1304230074513358929';  // Your Application ID

RPC.register(clientId);
const rpc = new RPC.Client({ transport: 'ipc' });

// Set timestamps
const startTimestamp = Math.floor(Date.now() / 1000);  // Current time in seconds
const endTimestamp = startTimestamp + 3600;            // End time 1 hour later (adjust as needed)

rpc.on('ready', () => {
    console.log('Rich Presence activated for AutoBE!');

    rpc.setActivity({
        details: 'Using AutoBE',
        state: 'Making Modpacks',
        startTimestamp: startTimestamp,         // Start time for countdown
        endTimestamp: endTimestamp,             // End time for countdown
        largeImageKey: 'we_did_it',             // Large image key
        largeImageText: 'AutoBE',               // Hover text for large image
        smallImageKey: 'tbl',                   // Small image key
        smallImageText: 'Rogue - Level 100',    // Hover text for small image
        partyId: 'ae488379-351d-4a4f-a',        // Party ID for group activity
        partySize: 1,                           // Current party size
        partyMax: 5,                            // Max party size
        joinSecret: 'MTI4NzM0OjFpMmhuMz',       // Join Secret for "Ask to Join"
        instance: true                          // Set to true for persistent display
    });
});

// Maintain the connection and status
rpc.login({ clientId }).catch(console.error);

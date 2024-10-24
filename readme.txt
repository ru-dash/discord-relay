Discord Selfbot Relay allows users to plug in their token and relay to particular channel_ids to discord webhooks.
This was created for EVE Online's Spy Meta. This was made after managing Intel related stuff for many years while running the largest Intelligence Organizations in EVE Online. I had written this as a thank you to one of my members seperately from all the tools I had written after he joined and helped me out a lot. This script includes many tricks such as preventing force embedding to detect the channels are being relayed, pretending to be a web client. This is a basic version made from scratch, there are a few bugs which will eventually be ironed out. Mainly role and username's not being converted their display names as well as everyone Catch's to target everyone/here/role targeted role mentions to handle groups deleting ping channels.

If you see anything else that might need fixed just put an issue and I might eventually add new features or fix bugs.
Saving and matching guild_id - member_ids and messages to a database is cool, but at scale bad. This includes very basic functionality.

Setup Guide
Install Node.js https://nodejs.org/en/download/package-manager

In the config.json set your token to your respective token.
Channel ids and webhook mappings set to as requested it will send the content of messages sent in that channel id to the webhook.

Run start.bat and the relay will begin. You should see messages outputting in console.

Leave the script running to keep the relay running.

# Discord Selfbot Relay
This project was created to relay messages from hostile discords to discord webhooks for intelligence in EVE Online. After managing Intel-related tasks for one of the largest coalitions in the game, I had retired. Using the knowledge I had gained, I developed this as a thank you to one of my friends who greatly helped my new alliance. It is intended to be lightweight tool that can be run locally.

# Features
* Relay messages from specific channel_ids to (discord) webhooks.
* Preventing abusing embedding images to detect channels being relayed.
* Mimics Desktop Client.

# Setup Guide
Download Node.js from the official website.
Install and unzip discord-relay from this github.
Open config.json.
Set your Discord token in the token field.
Map your channel_ids and webhooks in the respective fields to relay messages from those channels to your desired webhooks.
Run the Script

Run start.bat to start the relay.
You should see the relay output messages in the console.
Keep the Script Running

Leave the script running to maintain the relay. If you restart your pc or close the application, it must be started again.

# Contribution & Support
If you encounter any issues or have suggestions for improvements, feel free to open an issue. While this project is fairly basic, future updates and bug fixes may be added over time.

# Discord Selfbot Relay
Discord Selfbot Relay allows users to plug in their token and relay messages from specific channel_ids to Discord webhooks.

# Purpose
This project was initially created as part of EVE Online's spy meta. After managing Intel-related tasks for many years and running one of the largest Intelligence Organizations in EVE Online, I developed this as a thank you to a member who greatly helped me. It’s a lightweight tool with several tricks, including:

# Features
* Relay messages from specific channel_ids to Discord webhooks.
* Preventing force embedding to detect channels being relayed.
* Pretending to be a web client to mimic Desktop Client.
* This is a basic version built from scratch, and while it works, a few bugs remain, mainly:

Known Bug: Roles and usernames not converting to text, but instead Discord ID. (<@ ) - I'll eventually fix this.
Feel free to submit issues if you find any bugs or have feature requests. I may eventually add new features or fix existing issues.

# Setup Guide
Install Node.js

Download Node.js from the official website.
Configuration

Open config.json.
Set your Discord token in the token field.
Map your channel_ids and webhooks in the respective fields to relay messages from those channels to your desired webhooks.
Run the Script

Run start.bat to start the relay.
You should see the relay output messages in the console.
Keep the Script Running

Leave the script running to maintain the relay.

# Contribution & Support
If you encounter any issues or have suggestions for improvements, feel free to open an issue. While this project is fairly basic, future updates and bug fixes may be added over time.

# Brawl Rush

A small browser arena game inspired by Brawl Stars.

Features:
- character selection before match
- unique skill per brawler (burst, dash, barrier)
- WASD movement + mouse aim + click shooting
- enemy waves with ranged attackers
- obstacle blocking and battlefield cover
- collectible gems and score system
- finite enemy waves; defeat every enemy and the boss to win
- 1v1 online matches with room codes

Run locally:

npm install
npm start

Open http://localhost:8080 in the browser. Create a room and share its four-character code. The other player opens the same address and joins with that code.

For players on another network, deploy the app to a host that allows WebSocket connections and share its public URL. Keep port 8080 reachable when hosting the server directly.

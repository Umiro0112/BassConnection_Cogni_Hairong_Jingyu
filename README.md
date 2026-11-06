# Presence Lab — Track 1 MVP

A minimal shared-memory prototype: photograph a handwritten postcard, upload it from a phone, and see it appear on a slowly rotating point-cloud bonsai on the kiosk screen.

## Start it

1. Open a terminal in this folder.
2. On macOS, double-click `start.command`. It creates the local Python environment and starts the server. Alternatively, install `requirements.txt` and run `python run.py`.
4. On the kiosk computer, open `http://localhost:8000`.

`start.command` creates a temporary HTTPS address for phone uploads, because campus Wi-Fi commonly blocks direct connections between devices. Keep its Terminal window open while using the installation. The QR code automatically uses the temporary address and stops working when the Terminal window closes. No account is required.

## Prototype behavior

- The server looks for the largest postcard-like quadrilateral, crops it, and corrects perspective. If it cannot confidently find four corners, it keeps the full photo.
- The kiosk checks for changes every two seconds.
- The upload form also has a server-rendered result page, so success or failure remains visible even when browser JavaScript is blocked.
- Up to 20 postcards stay on the tree. Uploading another archives the oldest visible postcard in the mailbox.
- Data is stored locally in `data/postcards.json`; processed photos are in `data/uploads/`.
- The rotating tree is a procedural 3D point-cloud interpretation of the supplied bonsai reference, projected through the browser's 2D Canvas. It does not require WebGL or hardware acceleration. Because the reference is a single photograph, its unseen depth and back side are generated rather than reconstructed.

## Realtime tradeoff

The MVP uses polling: every two seconds the kiosk asks for the current postcard list. Compared with manual refresh, this adds a small periodic request and a little synchronization logic, while preserving the immediate installation experience. A WebSocket or database realtime subscription could push each upload instantly, but would also require connection lifecycle, reconnect, duplicate-event, and deployment infrastructure work. For this prototype, polling is the smallest dependable option and the visible delay is at most two seconds.

.PHONY: install build dev run clean link global-install local-run

install: build
	cd backend && pip install -r requirements.txt

build:
	cd frontend && npm install && npm run build
	cp frontend/node_modules/react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs frontend/dist/pdf.worker.min.mjs

dev:
	cd backend && python3 -m uvicorn main:app --host 0.0.0.0 --port 8200 --reload

run:
	cd backend && python3 cli.py

clean:
	rm -rf frontend/dist frontend/node_modules backend/__pycache__

# --- Local CLI mode (npm) -------------------------------------------------
# Install `pdfpal` as a global command. Builds the frontend first so the
# built SPA is shipped inside the installed package.
global-install: build
	npm install -g .

# Symlink `pdfpal` to this checkout (dev workflow; live edits to the
# frontend dist are reflected without reinstalling).
link: build
	npm link

# Run the locally installed `pdfpal` command without installing globally.
local-run: build
	node bin/pdfpal.js

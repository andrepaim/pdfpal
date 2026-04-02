.PHONY: install build dev run clean

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

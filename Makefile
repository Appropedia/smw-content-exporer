#Makefile parameters
DESTINATION ?= dist

#Variables related to JavaScript source handling
ENTRY_POINT   = src/content-explorer.js
INPUT_SOURCES = $(wildcard src/*.js)
BUNDLE_DIR    = $(DESTINATION)/src
BUNDLE_JS     = $(BUNDLE_DIR)/content-explorer.js

#Variables related to the main HTML file
INPUT_HTML  = index.html
BUNDLE_HTML = $(DESTINATION)/index.html

#Variables related to content directories and samples
CONTENT_DIRS      = views templates css
DEST_CONTENT_DIRS = $(addprefix $(DESTINATION)/,$(CONTENT_DIRS))
SAMPLE_SOURCES    = $(foreach f,$(CONTENT_DIRS),$(wildcard samples/$f/*))
DEST_SAMPLE_FILES = $(patsubst samples/%,$(DESTINATION)/%,$(SAMPLE_SOURCES))

#The default target shows a help screen
.PHONY: help
help:
	@echo "Welcome to the Content Explorer for Semantic MediaWiki!"
	@echo
	@echo "Here are some useful make targets:"
	@echo
	@echo "- Setup runtime dependencies (requires npm, needs to be done once):"
	@echo "  make setup"
	@echo
	@echo "- Deploy the application to the specified server document directory (defaults to"\
	      "dist)"
	@echo "  make deploy DESTINATION=path/to/server/document/directory"
	@echo
	@echo "- Deploy the application as before, but include sample files as well"
	@echo "  make deploy_samples DESTINATION=path/to/server/document/directory"

#The setup rule installs esbuild via npm
.PHONY: setup
setup:
	npm approve-scripts esbuild
	npm install esbuild

#The deployment rule bundles the JavaScript sources, copies the main HTML file and creates the
#destination content directories if they don't exist yet
.PHONY: deploy
deploy: $(BUNDLE_JS) $(BUNDLE_HTML) $(DEST_CONTENT_DIRS)

#The sample deployment rule does all of the above and also copies the sample files
.PHONY: deploy_samples
deploy_samples: deploy $(DEST_SAMPLE_FILES)

#Rule for creating directories
$(BUNDLE_DIR) $(DEST_CONTENT_DIRS):
	mkdir -p $@

#Rule for bundling JavaScript sources
$(BUNDLE_JS): $(INPUT_SOURCES) | $(BUNDLE_DIR)
	npx esbuild $(ENTRY_POINT) --bundle --minify --sourcemap --target=es2024 --format=esm \
	--outfile=$@

#Rule for copying the main HTML file
$(BUNDLE_HTML): $(INPUT_HTML)
	cp $< $@

#Rule for copying the sample fiiles
$(DEST_SAMPLE_FILES): $(DESTINATION)/%: samples/%
	cp $< $@

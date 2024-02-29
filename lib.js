// NODE
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

// BUN
import { serve as bunServe } from 'bun';

// EXTERNAL
import MarkdownIt from 'markdown-it';
import * as yamlFront from "yaml-front-matter";

// Comment

export function Gondola(dir) {
	/** Generates a URL-friendly slug based on specified parameters in a line. **/
	function decipherSlug(data, line) {
		const slugParams = line.split('--');
		const slug = slugParams.map(param => {
			if (typeof data[param] === 'string') {
				try {
					return data[param]
						.normalize('NFD') // Normalize to decompose combined graphemes
						.replace(/[\u0300-\u036f]/g, '') // Remove diacritics
						.replace(/[^\w\- ]+/g, '') // Remove non-word chars except hyphens and spaces
						.trim() // Remove leading and trailing spaces
						.replace(/\s+/g, '-') // Replace spaces with hyphens
						.replace(/-+/g, '-') // Replace multiple hyphens with a single one
						.toLowerCase(); // Convert to lowercase
				} catch (error) {
					console.error(`Error: Could not use ${param} at ${line}.`);
				}
			} else {
				console.error(`Error: ${data[param]} is not a 'string' at ${line}.`);
			}
			return '';
		}).join('-');

		return slug;
	}

	/* Parses dates using a designated format */
	function parseDate(dateString, format) {
		let dateParts, year, month, day;

		try {
			if (format === 'EPOCH') {
				return new Date(parseInt(dateString, 10) * 1000);
			} else if (format === 'MONTH DAY, YEAR') {
				dateParts = dateString.split(' ');
				month = new Date(dateParts[0] + " 1, 2020").getMonth();
				day = parseInt(dateParts[1].replace(',', ''), 10);
				year = parseInt(dateParts[2], 10);
			} else {
				dateParts = dateString.split(/-|\//);

				if (dateParts.length === 3) {
					if (format === 'MMDDYYYY') {
						month = parseInt(dateParts[0], 10) - 1;
						day = parseInt(dateParts[1], 10);
						year = parseInt(dateParts[2], 10);
					} else if (format === 'DDMMYYYY') {
						day = parseInt(dateParts[0], 10);
						month = parseInt(dateParts[1], 10) - 1;
						year = parseInt(dateParts[2], 10);
					} else if (format === 'YYYYMMDD') {
						year = parseInt(dateParts[0], 10);
						month = parseInt(dateParts[1], 10) - 1;
						day = parseInt(dateParts[2], 10);
					} else {
						throw new Error(`Gondola effectively parsed your Date: ${dateString}, but it DOES NOT match any of the supported formats. Your format is ${format}.`);
					}
				} else if (dateParts.length === 1) {
					if (format === 'MMDDYYYY') {
						month = parseInt(dateString.substring(0, 2), 10) - 1;
						day = parseInt(dateString.substring(2, 4), 10);
						year = parseInt(dateString.substring(4, 8), 10);
					} else if (format === 'DDMMYYYY') {
						day = parseInt(dateString.substring(0, 2), 10);
						month = parseInt(dateString.substring(2, 4), 10) - 1;
						year = parseInt(dateString.substring(4, 8), 10);
					} else if (format === 'YYYYMMDD') {
						year = parseInt(dateString.substring(0, 4), 10);
						month = parseInt(dateString.substring(4, 6), 10) - 1;
						day = parseInt(dateString.substring(6, 8), 10);
					} else {
						throw new Error(`Gondola effectively parsed your Date: ${dateString}, but it DOES NOT match any of the supported formats. Your format is ${format} and it DOES NOT contain delimiters.`);
					}
				}
			}
		} catch(error) {
			console.error(`${error}. Please check Gondola's documentation to ensure your format designation is written correctly. Gondola checks dates for "-" or "/". If it doesn't find these it assumes the string is written without any delimiters.`)
		}

		return new Date(year, month, day);
	}

	/** Combines the default settings with user settings **/
	async function getSettings() {
		try {
			let defaultSettings = {
				starter: '',
				output: '_site',
				appOutput: '_app',
				includes: '_includes',
				components: '_components',
				drafts: '_drafts',
				data: '_data',
				ignore: [
					'.git',
					'.gitignore',
					'node_modules',
					'package.json',
					'bun.lockb',
					'gondola.js',
					'package-lock.json'
				],
				pass: []
			};

			let userSettings;
			let joinedSettings = {};

			if (fs.existsSync(path.resolve(dir, 'gondola.js'))) {
				const {default: defaultFunc} = await import(path.resolve(dir, 'gondola.js'))
				userSettings = defaultFunc();
			} else {
				userSettings = {};
			}

			Object.entries(userSettings).forEach(([key, value]) => {
				if (Array.isArray(value)) {
					const defaultArray = Object.entries(defaultSettings);
					const match = defaultArray.find(([default_key, default_value]) => {
						return default_key === key
					});

					if (match !== undefined) {
						joinedSettings[key] = [...match[1], ...value]
					} else {
						joinedSettings[key] = value
					}
				} else {
					joinedSettings[key] = value
				}
			});

			return {...defaultSettings, ...joinedSettings};
		} catch (error) {
			console.error(`ERROR: Could not get "settings" from "gondola.js". Please make sure the following is addressed:
				- The function within gondola.js is the 'default' function.
				- The function returns an object {} with starter, output, includes, drafts, ignore, pass, or data keys in order to overwrite the default settings.
			`, error);
		}
	}

	/** Reads the project "starter" directory and creates file_objects from file information. **/
	async function getFiles(settings, baseDir) {
		const files = [];

		async function createFileObj(filePath, baseDir) {
			const stats = await fs.promises.stat(filePath);
			const ext = path.extname(filePath).slice(1);
			const relativePath = path.relative(baseDir, filePath);
			const absolutePath = path.resolve(process.cwd(), relativePath);

			let obj = {
				name: path.basename(filePath),
				path: relativePath,
				origin: absolutePath,
				ext: ext,
				size: stats.size,
				created: stats.birthtime,
				modified: stats.mtime,
				mode: stats.mode
			};


			if (ext === "js") {
				try {
		            const importedModule = await import(obj.origin);

		            // Check if 'config' function exists in the imported module
		            if (typeof importedModule.config === 'function') {
		                obj = { ...obj, ...importedModule.config() };
		            }
		        } catch (error) {
		            console.error(`ERROR processing JS file at ${obj.origin}`, error);
		        }
			}

			if (ext === "md") {
				let templateObj;

				try {
					templateObj = yamlFront.loadFront(await Bun.file(obj.origin).text());
				} catch (error) {
					console.error(`ERROR parsing YAML front matter at ${obj.origin}:`, error);
				}

				if (templateObj) {
					try {
						const md = new MarkdownIt({
							html: true
						});

						// Render Markdown to HTMLtemplateObj
						let rawHtml = md.render(templateObj.__content);

						// Sanitize the HTML
						templateObj.contents = rawHtml;
						delete templateObj.__content;
						obj = {...obj, ...templateObj};
					} catch (error) {
						console.error(`ERROR parsing Markdown at ${obj.origin}:`, error);
					}
				}
			}

			if (ext === "json") {
			    let dataString;
			    let dataObj;

			    try {
			        dataString = await Bun.file(obj.path).text();
			    } catch (error) {
			        console.error(`ERROR getting text from ${obj.path}.`, error);
			    }

			    if (dataString) {
			        try {
			            dataObj = JSON.parse(dataString);

			            // Process Markdown content in JSON data recursively
			            const md = new MarkdownIt({ html: true });
			            function processMarkdownContent(obj) {
			                if (Array.isArray(obj)) {
			                    // If it's an array, process each item
			                    obj.forEach(item => processMarkdownContent(item));
			                } else if (obj && typeof obj === 'object') {
			                    // If it's an object, process each key
			                    for (let key in obj) {
			                        if (obj.hasOwnProperty(key)) {

			                            // Check for keys ending with '_md'
			                            if (key.endsWith('_md')) {
			                                obj[key] = md.render(obj[key]);
			                            }

			                            // Check for 'g_format' property set to 'markdown'
			                            if (obj[key] && typeof obj[key] === 'object' && obj[key].g_format === 'markdown' || obj[key].g_format === 'md') {
			                                obj[key].body = md.render(obj[key].body);
			                            }

			                            // Recursive call for nested objects and arrays
			                            processMarkdownContent(obj[key]);
			                        }
			                    }
			                }
			            }

			            processMarkdownContent(dataObj);
			        } catch (error) {
			            console.error(`ERROR parsing JSON from ${obj.path}`, error);
			        }
			    }

			    if (dataObj && dataObj.collections) {
			        obj = {...obj, ...dataObj};
			    } else {
			        obj.data = dataObj;
			    }
			}

			files.push(obj);
		}

		async function read(currentDir) {
			const file_entries = await fs.promises.readdir(currentDir);

			const filtered_entries = file_entries
				.filter(entry => !settings.ignore.includes(entry))
				.filter(entry => !settings.pass.includes(entry))
				.filter(entry => entry !== settings.output)
				.filter(entry => !entry.startsWith('.'))
				.map(async entry => {
					const entryPath = path.join(currentDir, entry);

					if (fs.existsSync(entryPath)) {
						const stats = await fs.promises.stat(entryPath);

						if (stats.isDirectory()) {
							await read(entryPath);
						} else {
							await createFileObj(entryPath, baseDir);
						}
					}
				});

			await Promise.all(filtered_entries);
		}

		await read(baseDir);

		return {settings, files};
	}

	/** Creates a global data object from file data using the name of the file as the key within the object. **/
	function setData({settings, files} = {}) {
		let data = {};

		files.forEach(file => {
			try {
				if (file.data) {
					const dataKey = file.name.split('.')[0];

					data[dataKey] = file.data;
				}
			} catch (error) {
				console.error(`ERROR: Could not get data from ${file.path}. Make sure your data is valid JSON. Gondola uses the filename as the key within the global "data" object.`);
			}
		});

		return {settings, files, data}
	}

	/** Creates a collection from an action or set of actions and houses them within a global collections object or generates files. **/
	async function setCollections({settings, files, data} = {}) {
		let collections = {};

		// COLLECTION MODS
		function sortCollection(setFiles, set) {
			let sortedFiles;

			if (set.sort.by === "date" || !set.sort.by) {
				sortedFiles = setFiles.sort((a, b) => {
				    const dateA = parseDate(a.date, set.sort.format.toUpperCase());
				    const dateB = parseDate(b.date, set.sort.format.toUpperCase());

				    if (set.sort.order === "newest" || !set.sort.order) {
						return dateB - dateA;
					}

					if (set.sort.order === "oldest") {
						return dateA - dateB;
					}
				});
			}

			if (set.sort.by === "title") {
			    sortedFiles = setFiles.sort((a, b) => a.title.localeCompare(b.title));
			}

			return sortedFiles;
		}

		// COLLECTION FROM FILES
		await Promise.all(files.filter(file => file.collections).map(async file => {
			async function pushToCollections(tag) {
				if (!collections.hasOwnProperty(tag)) {
					if (file.fetch) {
						const fetchResponse = await fetch(file.fetch);
						const fetchData = await fetchResponse.json();
						let collectionData;
						if (file.hasOwnProperty('fetchCollection')) {
							collectionData = fetchData[file.fetchCollection];
						} else {
							collectionData = fetchData;
						}
						collections[tag] = [];
						collections[tag] = collectionData;
					} else {
						collections[tag] = [];
						collections[tag].push(file);
					}
				} else {
					collections[tag].push(file);
				}
			}

			function collectionFromArray(arr) {
				arr.forEach(tag => {
					try {
						pushToCollections(tag);
					} catch (error) {
						console.error(`ERROR adding file to ${tag} collection:`, error);
					}
				});
			}

			Array.isArray(file.collections) ? collectionFromArray(file.collections)
			: typeof file.collections === 'string' ? await pushToCollections(file.collections)
			: console.error(`ERROR: "collections:" needs to be a "String" or an "Array"`)
		})).then(file => console.log('done with collections from files'));

		// COLLECTION FROM SETTINGS
		if (settings.collect) {
			if (Array.isArray(settings.collect)) {
				settings.collect.map(collection => {
					function runAction(set, action) {
						const dirPath = set.path;

						function getCollectionFiles(collections, set) {
							let collection_files;

							Object.entries(collections).map(([key, value]) => {
								if (key === set.collection) {
									collection_files = collections[key];
								}
							});

							return collection_files.map(file => {
								const slug = decipherSlug(file, set.slug);
								file.path = path.join(`${set.path}/${slug}`);
								file.type = !file.type ? set.type : 'page';
								file.state = !file.state ? set.state : file.state;
								file.layout = !file.layout ? set.layout : file.layout;
								file.meta = !file.meta ? set.meta : {};
								if (!file.name) {
									file.name = path.basename(file.path)
								}

								file.created = !file.created ? new Date() : file.created;
								file.modified = !file.modified ? new Date() : file.modified;
								return file;
							});
						}

						// ACTIONS
						function paginate(set) {
							let modifiedFiles = getCollectionFiles(collections, set);

							// SORT
							if (set.sort) {
								modifiedFiles = sortCollection(modifiedFiles, set);
							}

							modifiedFiles = modifiedFiles.map(file => {
								file.type = "page";
								return file;
							});

							return modifiedFiles;
						}

						function paginateGroups(set) {
							// Get files from collections
							let modifiedFiles = getCollectionFiles(collections, set);

							// SORT
							if (set.sort) {
								modifiedFiles = sortCollection(modifiedFiles, set);
							}

							// SIZE
							if (!set.size) {
								console.error(`ERROR: You need to set a SIZE for ${set.collection}.`);
								return;
							}

							// DEFAULTS
							// let iterateWith;
							// let startAt;

							// set.iterateWith ? iterateWith = set.iterateWith : iterateWith = 'number';
							// set.startAt ? startAt = set.startAt : startAt = '';

							function chunkArray(arr, size) {
								return arr.length > size ? [arr.slice(0, size), ...chunkArray(arr.slice(size), size)]
								: [arr];
							}

							const chunkedData = chunkArray(modifiedFiles, set.size);

							const newPages = chunkedData.map(arr => {
								const position = chunkedData.indexOf(arr);
								const n = chunkedData.length - 1;
								let pagePath;
								let hrefsArray = [];
								let params = {};
								let pageData = {};

								function iterate(n){
									if (n !== 0) {
										hrefsArray.push(`${dirPath}/${n}`);
										n = n-1;
										iterate(n);
									} else {
										hrefsArray.push(`${dirPath}`);
										return
									}
								}

								position === 0 ? pagePath = `${dirPath}` : pagePath = `${dirPath}/${position}`;

								iterate(n);

								hrefsArray.sort();

								if (position !== 0 && position !== n) {
									params = {
										next: `${dirPath}/${position + 1}`,
										previous: `${dirPath}/${position - 1}`,
										first: `${dirPath}`,
										last: `${dirPath}/${n}`,
									}

									pageData = {
										items: arr,
										next: chunkedData[position + 1],
										previous: chunkedData[position - 1],
										first: chunkedData[0],
										last: chunkedData[n],
									}
								} else if (position === 0) {
									params = {
										next: `${dirPath}/${position + 1}`,
										previous: undefined,
										first: undefined,
										last: `${dirPath}/${n}`,
									}

									pageData = {
										items: arr,
										next: chunkedData[position + 1],
										previous: undefined,
										first: undefined,
										last: chunkedData[n],
									}
								} else if (position === n) {
									params = {
										next: undefined,
										previous: `${position === 1 ? `${dirPath}` : `/${position - 1}`}`,
										first: `${dirPath}`,
										last: undefined,
									}

									pageData = {
										items: arr,
										next: undefined,
										previous: chunkedData[position - 1],
										first: chunkedData[0],
										last: undefined,
									}
								}

								const newPage = {
									name: pagePath,
									path: pagePath,
									type: 'page',
									state: set.state,
									layout: set.layout,
									meta: set.meta,
									hrefs: hrefsArray,
									href: params,
									pages: chunkedData,
									page: pageData
								}

								return newPage;
							});

							modifiedFiles = newPages;

							return modifiedFiles;
						}

						// Use files colllection as base
						function remedyFiles(array1, array2) {

							const new_objs = [];

							const updated_files = array1.map(obj1 => {
								const matching_obj = array2.find(obj2 => obj1.name === obj2.name);

								if (matching_obj) {
									new_objs.push(matching_obj);
								} else {
									new_objs.push(obj1)
								}
							});

							array2.map(obj2 => {
								const matching_obj = new_objs.find(obj3 => obj3.name === obj2.name);

								if (matching_obj) {
									return
								} else {
									new_objs.push(obj2)
								}
							})

							return new_objs;
						}

						action === "paginate" ? files = remedyFiles(files, paginate(set))
						: action === "paginateGroups" ? files = remedyFiles(files, paginateGroups(set))
						: console.error(`Error: There is no function for "${action}". You can create one and pass it through in your settings with "custom: {action: yourAction()}. Default actions offered by Gondola are: [paginate, paginateGroups]`);
					}

					function runActions(collection) {
						collection.actions.forEach(action => {
							runAction(collection, action);
						});
					}

					Array.isArray(collection.actions) && collection.actions.length === 1 ? runAction(collection, collection.actions[0])
					: Array.isArray(collection.actions) && collection.actions.length > 1 ? runActions(collection)
					: console.error(`Error: Your collection "${collection.collection}" must be an Array and contain at least one action.`)
				})
			} else if (typeof settings.collect === 'string') {
				console.error(`Error: "collect" in gondola.js must be an Array.`);
			}
		}

		return {settings, files, data, collections}
	}

	/** Creates a contents key/value pair within the file object that houses the template for that file. **/
	function setTemplates({settings, files, data, collections} = {}) {
		return Promise.all(files.map(async obj => {
				if (obj.ext === "js" && obj.type !== "layout") {
					try {
						const {default: defaultFunc} = await import(obj.origin);
						obj.contents = await defaultFunc({data: data, collections: collections, context: obj});
					} catch (error) {
						console.error(`ERROR importing default function at ${obj.origin}.`);
					}
				}


				if (obj.ext === "md") {
					let templateObj;

					try {
						templateObj = yamlFront.loadFront(await Bun.file(obj.origin).text());
					} catch (error) {
						console.error(`ERROR parsing YAML front matter at ${obj.origin}:`, error);
					}

					if (templateObj) {
						try {
							const md = new MarkdownIt({
								html: true
							});

							// Render Markdown to HTML
							let rawHtml = md.render(templateObj.__content);

							// Sanitize the HTML
							templateObj.contents = rawHtml;
							delete templateObj.__content;
							obj = {...obj, ...templateObj};
						} catch (error) {
							console.error(`ERROR parsing Markdown at ${obj.origin}:`, error);
						}
					}
				}

				return obj;
			})
		).then(files => {
			return {settings, files, data, collections}
		})
	}

	/** Creates an html layout which typically houses the contents of specified file object. **/
	async function setLayouts({settings, files, data, collections} = {}) {
	    async function applyLayout(file, files, data, collections) {
	        if (!file.layout) {
	            return file.contents; // No further layout to apply
	        }

	        const layoutPath = path.resolve(dir, file.layout);

	        try {
	            const layoutFunc = (await import(layoutPath)).default;
	            if (typeof layoutFunc !== 'function') {
	                throw new Error(`ERROR: Layout at ${layoutPath} does not export a default function`);
	            }

	            const updatedFileContents = await layoutFunc({data: data, collections: collections, context: file});
	            file.contents = updatedFileContents;

	            const nextLayoutFile = files.find(f => f.path === file.layout);

	  			if (nextLayoutFile.layout) {
	  				file.layout = nextLayoutFile.layout;
	  				return await applyLayout(file, files, data, collections); // Recursion
	  			} else {
	  				return file.contents;
	  			}
	        } catch (error) {
	            console.error(`ERROR applying layout from ${layoutPath}.`);
	            return file;
	        }
	    }

	    const updatedFiles = await Promise.all(
	        files.map(async file => {
	            if (file.type === 'page') {
	                file.contents = await applyLayout(file, files, data, collections);
	            }
	            return file;
	        })
	    );

	    return {settings, files: updatedFiles, data, collections};
	}

	/** Creates a RSS feed based on a set collection within the settings object. **/
	function genSyndication(settings, config, feed) {
		const feedType = config.feedType;

		function assignTemplate(type, config, feed) {
			let template;

			if (type === 'RSS') {
				template = `
					<?xml version="1.0" encoding="utf-8"?>
					<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xml:base="${config.link}" xmlns:atom="http://www.w3.org/2005/Atom">
					  <channel>
					    <title>${config.title}</title>
					    <link>${config.link}</link>
					    <description>${config.description}</description>
					    <language>${config.language || "en"}</language>
					    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
					    <atom:link href="${config.link}" rel="self" type="application/rss+xml" />
					    ${feed
						    .toSorted((a, b) => parseDate(b.date, config.dateFormat) - parseDate(a.date, config.dateFormat))
						    .map(item => {
						    	const title = item.title;
						    	const date = parseDate(item.date, config.dateFormat).toUTCString()
						    	const itemLink = path.join(`${config.link}/${item.path}`);
						    	return `
						    		<item>
								      <title>${title}</title>
								      <link>${itemLink}</link>
								      <description>${item.description}</description>
								      <pubDate>${date}</pubDate>
								      <guid>${itemLink}</guid>
								    </item>
						    	`;
						    })
						    .join('')
						}
					  </channel>
					</rss>
				`;
			} else if (type === 'ATOM') {
			  template = `
			    <?xml version="1.0" encoding="utf-8"?>
			    <feed xmlns="http://www.w3.org/2005/Atom">
			      <title>${config.title}</title>
			      <link href="${config.link}" rel="self"/>
			      <updated>${new Date().toISOString()}</updated>
			      <id>${config.link}</id>
			      ${feed
			        .toSorted((a, b) => parseDate(b.date, config.dateFormat) - parseDate(a.date, config.dateFormat))
			        .map(item => {
			          const title = item.title;
			          const date = parseDate(item.date, config.dateFormat).toISOString();
			          const itemLink = path.join(`${config.link}/${item.path}`);
			          return `
			            <entry>
			              <title>${title}</title>
			              <link href="${itemLink}"/>
			              <id>${itemLink}</id>
			              <updated>${date}</updated>
			              <summary>${item.description}</summary>
			            </entry>
			          `;
			        })
			        .join('')
			      }
			    </feed>
			  `;
			} else if (type === 'JSONFEED') {
				const items = feed
			    .toSorted((a, b) => parseDate(b.date, config.dateFormat) - parseDate(a.date, config.dateFormat))
			    .map(item => {
			      const title = item.title;
			      const date = parseDate(item.date, config.dateFormat).toISOString();
			      const itemLink = path.join(`${config.link}/${item.path}`);
			      return {
			        id: itemLink,
			        url: itemLink,
			        title: title,
			        content_text: item.description,
			        date_published: date
			      };
			    });

			  template = JSON.stringify({
			    version: "https://jsonfeed.org/version/1",
			    title: config.title,
			    home_page_url: config.link,
			    feed_url: `${config.link}/feed.json`,
			    items: items
			  }, null, 2); // Pretty print the JSON
			}

			template = template
			    .split('\n')           // Split by newline
			    .map(line => line.trim()) // Trim each line
			    .filter(line => line)  // Remove empty lines
			    .join('\n');           // Join the lines back together

			return {type, template};
		}

		function createPage({type, template} = {}) {
			let destination;
			type === 'RSS' ? destination = `${settings.output}/feed.xml`
			: type === 'ATOM' ? destination = `${settings.output}/feed.atom`
			: type === 'JSONFEED' ? destination = `${settings.output}/feed.json`
			: console.error(`Could not create path for ${type}`)

			const destDir = path.parse(destination).dir;
			fs.mkdirSync(destDir, {recursive: true})
			fs.writeFileSync(destination, template)

			console.log(`WROTE: ${destination}`);
		}

		if (Array.isArray(feedType)) {
			feedType.forEach(type => createPage(assignTemplate(type.toUpperCase(), config, feed)))
		} else {
			createPage(assignTemplate(feedType.toUpperCase(), config, feed))
		}
	}

	/** Creates the various parts of a simple PWA based on the settings object. **/
	function genPWA(settings, config) {

		function generateManifest(config) {
			let manifestData;

			if (typeof config.manifest === 'string') {
				// Read manifest data from file
				const filePath = config.manifest;
				manifestData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			} else if (typeof config.manifest === 'object') {
				// Use the object directly
				manifestData = config.manifest;
			} else {
				throw new Error('Invalid manifest configuration');
			}

			// Generate manifest.json
			const manifestJSON = JSON.stringify(manifestData, null, 2);
			const destination = `${settings.appOutput}/manifest.json`;
			const destDir = path.parse(destination).dir;
			fs.mkdirSync(destDir, {recursive: true})
			fs.writeFileSync(destination, manifestJSON);
			console.log(`WROTE APP MANIFEST: ${settings.appOutput}/manifest.json`);
		}

		function generateFetchStrategy(config) {
		    let strategyCode = '';

		    switch (config.fetchStrategy) {
		        case 'CacheFirst':
		            strategyCode = `
		                self.addEventListener('fetch', function(event) {
		                    event.respondWith(
		                        caches.match(event.request)
		                            .then(function(response) {
		                                return response || fetch(event.request);
		                            })
		                    );
		                });
		            `;
		            break;
		        case 'NetworkFirst':
		            strategyCode = `
		                self.addEventListener('fetch', function(event) {
		                    event.respondWith(
		                        fetch(event.request).catch(function() {
		                            return caches.match(event.request);
		                        })
		                    );
		                });
		            `;
		            break;
		        case 'CacheOnly':
		            strategyCode = `
		                self.addEventListener('fetch', function(event) {
		                    event.respondWith(caches.match(event.request));
		                });
		            `;
		            break;
		        case 'NetworkOnly':
		            strategyCode = `
		                self.addEventListener('fetch', function(event) {
		                    event.respondWith(fetch(event.request));
		                });
		            `;
		            break;
		        case 'StaleWhileRevalidate':
		            strategyCode = `
		                self.addEventListener('fetch', function(event) {
		                    event.respondWith(
		                        caches.match(event.request)
		                            .then(function(response) {
		                                const fetchPromise = fetch(event.request).then(function(networkResponse) {
		                                    caches.open('dynamic-cache').then(function(cache) {
		                                        cache.put(event.request, networkResponse.clone());
		                                        return networkResponse;
		                                    });
		                                });
		                                return response || fetchPromise;
		                            })
		                    );
		                });
		            `;
		            break;
		        default:
		            throw new Error('Invalid fetch strategy');
		    }

		    return strategyCode;
		}

		function generateUpdateStrategy(config) {
			let strategyCode = '';

			switch (config.updateStrategy) {
			    case 'autoUpdate':
			        strategyCode = `
			            self.addEventListener('fetch', function(event) {
			                event.respondWith(
			                    caches.open('dynamic-cache').then(function(cache) {
			                        return fetch(event.request).then(function(response) {
			                            cache.put(event.request, response.clone());
			                            return response;
			                        });
			                    })
			                );
			            });
			        `;
			        break;
			    case 'onPrompt':
			        strategyCode = `
			            self.addEventListener('message', function(event) {
			                if (event.data.action === 'skipWaiting') {
			                    self.skipWaiting();
			                }
			            });

			            // In your web app, you'll need to prompt the user and then send this message
			            // navigator.serviceWorker.controller.postMessage({action: 'skipWaiting'});
			        `;
			        break;
			    case 'onTag':
			        strategyCode = `
			            self.addEventListener('fetch', function(event) {
			                if (event.request.headers.get('data-cache') === 'true') {
			                    event.respondWith(
			                        caches.open('dynamic-cache').then(function(cache) {
			                            return fetch(event.request).then(function(response) {
			                                cache.put(event.request, response.clone());
			                                return response;
			                            });
			                        })
			                    );
			                }
			            });
			        `;
			        break;
			    case 'onRestart':
			        strategyCode = `
			            self.addEventListener('activate', function(event) {
			                event.waitUntil(
			                    caches.keys().then(function(cacheNames) {
			                        return Promise.all(
			                            cacheNames.map(function(cacheName) {
			                                // Clear out old cache
			                            })
			                        );
			                    })
			                );
			            });
			        `;
			        break;
			    default:
			        throw new Error('Invalid update strategy');
			}

			return strategyCode;
		}

		function generateInstallStrategy(config) {
			switch (config.installStrategy) {
			    case 'button':
			        strategyCode = `
			            self.addEventListener('fetch', function(event) {
			                event.respondWith(
			                    caches.open('dynamic-cache').then(function(cache) {
			                        return fetch(event.request).then(function(response) {
			                            cache.put(event.request, response.clone());
			                            return response;
			                        });
			                    })
			                );
			            });
			        `;
			        break;
			    case 'browserOnly':
			        strategyCode = `
			            self.addEventListener('message', function(event) {
			                if (event.data.action === 'skipWaiting') {
			                    self.skipWaiting();
			                }
			            });

			            // In your web app, you'll need to prompt the user and then send this message
			            // navigator.serviceWorker.controller.postMessage({action: 'skipWaiting'});
			        `;
			        break;
			    default:
			        throw new Error('Invalid update strategy');
			}
		}

		function generateExtensions(config) {}

		function writeToServiceWorker(fetchStrategyCode, updateStrategyCode, installStrategyCode, extensionsCode, filePath) {
		    // Read the existing content
		    let existingContent = '';
		    if (fs.existsSync(filePath)) {
		        existingContent = fs.readFileSync(filePath, 'utf8');
		    }

		    // Combine the content
		    const combinedContent = existingContent + fetchStrategyCode + updateStrategyCode + installStrategyCode + extensionsCode;

		    // Write the combined content to the file
		    fs.writeFileSync(filePath, combinedContent);

			const strategies = JSON.stringify(combinedContent, null, 2);
			const destination = `${settings.appOutput}/${config.swOutput || 'sw.js'}`;
			const destDir = path.parse(destination).dir;
			fs.mkdirSync(destDir, {recursive: true})
			fs.writeFileSync(destination, strategies);

			console.log(`WROTE SERVICE WORKER: ${destination}`);
		}

		const fetchStrategyCode = generateFetchStrategy(config);
		const updateStrategyCode = generateUpdateStrategy(config);
		const installStrategyCode = generateInstallStrategy(config);
		const extensionsCode = generateExtensions(config);
		const serviceWorkerFilePath = config.swOutput || 'sw.js';

		generateManifest(config)
		writeToServiceWorker(fetchStrategyCode, updateStrategyCode, installStrategyCode, extensionsCode, serviceWorkerFilePath);

		/* async function optimizeImage(imagePath, sizes, outputDir) {
			// Dynamically import sharp
			const sharp = await import('sharp');

			// Ensure output directory exists
			if (!fs.existsSync(outputDir)) {
				fs.mkdirSync(outputDir, { recursive: true });
			}

			// Process each size and create resized images
			return Promise.all(sizes.map(async size => {
				const outputFilePath = path.join(outputDir, `icon-${size}.png`);

				try {
					await sharp(imagePath)
						.resize(size, size) // Resize maintaining aspect ratio
						.toFormat('png')    // Convert to PNG
						.toFile(outputFilePath);

					console.log(`Generated icon: ${outputFilePath}`);
					return outputFilePath;
				} catch (error) {
					console.error(`Error generating icon of size ${size}:`, error);
					return null;
				}
			}));
		}

		// Example Usage
		async function generatePWAIcons() {
			const sourceImagePath = 'path/to/source/image.jpg';
			const iconSizes = [128, 256, 512]; // Example sizes
			const outputDir = 'path/to/output/icons';

			try {
				const icons = await optimizeImage(sourceImagePath, iconSizes, outputDir);
				console.log('Generated Icons:', icons);
			} catch (error) {
				console.error('Error generating PWA icons:', error);
			}
		} */
	}

	/** Creates a sitemap file based on the output directory **/
	async function generateSitemap(fileTree, outputDir, baseUrl) {
	    function getFilesRecursively(directory) {
	        const entries = fs.readdirSync(directory, { withFileTypes: true });
	        let files = [];

	        for (let entry of entries) {
	            const entryPath = path.join(directory, entry.name);
	            if (entry.isDirectory()) {
	                files = [...files, ...getFilesRecursively(entryPath)];
	            } else {
	                // Exclude non-HTML files
	                if (path.extname(entry.name) === '.html') {
	                    const stats = fs.statSync(entryPath);
	                    files.push({
	                        path: entryPath,
	                        modified: stats.mtime
	                    });
	                }
	            }
	        }

	        return files;
	    }

	    function determinePriority(filePath) {
	        // Count the depth based on the number of slashes in the relative path
	        const depth = (filePath.match(new RegExp("/", "g")) || []).length;

	        // Assign priority based on depth
	        switch (depth) {
	            case 0: return '1.0'; // Root level (e.g., home page)
	            case 1: return '0.8'; // First level
	            case 2: return '0.6'; // Second level
	            default: return '0.5'; // Deeper levels or default
	        }
	    }

	    const files = getFilesRecursively(outputDir);

	    const urls = files.map(file => {
	        let relativePath = path.relative(outputDir, file.path);
	        let lastMod;
	        fileTree.forEach(obj => {
	        	if (`${outputDir}/${relativePath}` === obj.path) {
	        		lastMod = obj.modified.toISOString();
	        	}
	        });
	        relativePath = relativePath.replace(/index.html$/, ''); // Remove index.html
	        relativePath = relativePath.replace(/\.html$/, ''); // Remove .html
	        let urlPath = `${baseUrl}/${relativePath}`;
	        let finalPath;
			if (urlPath[urlPath.length - 1] !== '/') {
				urlPath = urlPath += '/'; // Append '/' if it's not there
			}
	       //const trimmedPath = urlPath.replace(/\/$/, "");
	       //const lastMod = file.modified.toISOString();
	        const priority = determinePriority(relativePath);
	        return `  <url><loc>${urlPath}</loc><lastmod>${lastMod}</lastmod><priority>${priority}</priority></url>`;
	    });

	    const sitemapContent = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">\n${urls.join('\n')}\n</urlset>`;
	    const destination = path.join(outputDir, 'sitemap.xml');
	    fs.writeFileSync(destination, sitemapContent);
	    console.log("WROTE SITEMAP:", destination);
	}

	/** Passes through directories and files specified in the settings object. **/
	function pass(settings) {
		const output = settings.output;
		settings.pass.forEach(item => {
			fs.cpSync(path.join(dir, item), path.join(output, item), {recursive: true})
			console.log(`PASSED: ${item}`)
		})
	}

	/** Creates a plugin chain for plugins to be used at build time. **/
	function use(tree, settings) {
		settings.use.forEach(plugin => {
			if (plugin.plugin === "syndication") {
				try {
					const feed = tree.collections[plugin.feed];
					setSyndication(settings, plugin, feed);
				} catch (error) {
					console.error(`Error: Could not create syndication for ${plugin.feed}.`);
				}
			}

			if (plugin.plugin === "pwa") {
				try {
					setPWA(settings, plugin);
				} catch (error) {
					console.error(`Error: Could not set PWA.`)
				}
			}

			if (plugin.plugin === "sitemap") {
				try {
					generateSitemap(tree, settings.output, plugin.baseUrl);
				} catch (error) {
					console.error(`Error: Could not generate sitemap.`);
				}
			}
		});
	}

	/** Creates an "output" of directories and files based on the result of a chain of functions. **/
	async function gen() {
		const start = Date.now();
		const settings = Object.freeze(await getSettings());
		const output = settings.output;

		// CHECK OUTPUT FOLDER
		fs.existsSync(output) === false ? fs.mkdirSync(output) :
		!settings.clean ? fs.rmSync(output, { recursive: true, force: true }) :
		settings.clean === false ? console.log(`GONDOLA: Building into current ${output}`) : console.log('building')

		// CHAIN
		const chain = await setLayouts(await setTemplates(await setCollections(setData(await getFiles(settings, dir)))));

		// PLUGINS (PREBUILD)
		if (settings.use) {
			settings.use.forEach(plugin => {
				if (plugin.plugin === "pwa" || plugin.plugin === "syndication" || plugin.timeline == "preBuild") {
					try {
						use(chain, settings);
					} catch (error) {
						console.error(`ERROR using plugins "preBuild". Check "gondola.js config file"`);
					}
				}
			});
		}

		// FILES
		const files = chain.files;

		let fileStats = [];

		// OUTPUT
		files.forEach(file => {
			if (file.type === 'page') {
				if (file.state === 'publish') {
					let destinationPath;

					if (file.path === '' || file.path === 'home.js' || file.path === 'index.js' || file.path === 'index.md' || file.path === 'home.md' || file.path === 'index.json') {
						destinationPath = '';
					} else {
						// Parse the file path to get the directory and name without extension
						const parsedPath = path.parse(file.path);
						const directoryPath = parsedPath.dir;
						const fileNameWithoutExt = parsedPath.name;

						// Construct the destination path
						destinationPath = path.join(directoryPath, fileNameWithoutExt);

						// Ensure destination path starts with a slash
						destinationPath = destinationPath.charAt(0) !== '/' ? `/${destinationPath}` : destinationPath;
					}

					let destination;

					if (!settings.coolUrls) {
						destination = `${output}${destinationPath}/index.html`;
					} else if (settings.coolUrls === false) {
						destination = `${output}${destinationPath}.html`;
					}

					// TEMPORARY
					fileStats.push({path: destination, modified: file.modified});

					// Create directory and write file
					const destDir = path.parse(destination).dir;
					fs.mkdirSync(destDir, {recursive: true});
					fs.writeFileSync(destination, file.contents);
					console.log("WROTE:", destination);
				} else if (file.state === 'draft') {
					console.log(`DRAFT: ${file.name}`);
				} else if (!file.state) {
					console.log(`UNDEFINED STATE: ${file.name}`);
				}
			}
		});

		// PLUGINS (POSTBUILD)
		if (settings.use) {
			settings.use.forEach(plugin => {
				if (plugin.plugin === "sitemap" || plugin.timeline == "postBuild") {
					try {
						use(fileStats, settings);
					} catch (error) {
						console.error(`ERROR using plugins "postBuild". Check "gondola.js config file"`);
					}
				}
			});
		}

		// PASS
		if (settings.pass) {
			try {
				pass(settings);
			} catch (error) {
				console.error(`ERROR passing over files and/or directories in settings:`, error);
			}
		}

		// END
		const end = Date.now();
		const total_time = (end - start) / 1000;
		console.log(`Built in ${total_time} seconds`);
	}

	/** Creates an http server. **/
	async function serve(port) {
	    const settings = await getSettings();
    	const outputDir = path.join(dir, settings.output);

		function getContentType(filePath) {
			const extension = path.extname(filePath);
			switch (extension) {
				case '.html': return 'text/html; charset=utf-8';
				case '.css': return 'text/css; charset=utf-8';
				case '.js': return 'application/javascript; charset=utf-8';
				case '.json': return 'application/json; charset=utf-8';
				case '.png': return 'image/png';
				case '.jpg': return 'image/jpeg';
				case '.jpeg': return 'image/jpeg';
				case '.gif': return 'image/gif';
				case '.svg': return 'image/svg+xml';
				default: return 'text/plain';
			}
		}

		bunServe({
			fetch(req) {
				try {
					let urlPath = new URL(req.url).pathname;
					let filePath = path.join(outputDir, urlPath);

					if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
						filePath = path.join(filePath, 'index.html');
					}

					if (fs.existsSync(filePath)) {
						const contentType = getContentType(filePath);

						return new Response(fs.readFileSync(filePath), {
							headers: { 'Content-Type': contentType }
						});
					}

					return new Response('File not found', { status: 404 });
				} catch (error) {
					console.error(`SERVER: Error serving ${req.url}:`, error);
					return new Response('Internal Server Error', { status: 500 });
				}
			},
			port: port
		});
		const url = `http://localhost:${port}`;

		console.log(`SERVER: Running on ${url}`);

		const start = (process.platform == 'darwin' ? 'open' : process.platform == 'win32' ? 'start' : 'xdg-open');
		exec(`${start} ${url}`, (err) => {
			if (err) {
				console.warn(`SERVER: Failed to automatically open browser. Server is running. Manually open ${url}.`);
			}
		});
	}

	return {
		gen: gen,
		serve: serve
	}
}
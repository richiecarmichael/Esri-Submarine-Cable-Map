/* ------------------------------------------------------------
   Developed by the Applications Prototype Lab
   (c) 2016 Esri | http://www.esri.com/legal/software-license  
--------------------------------------------------------------- */

require([
    'esri/Map',
    'esri/Graphic',
    'esri/Color',
    'esri/geometry/Point',
    'esri/geometry/geometryEngine',
    'esri/geometry/support/webMercatorUtils',
    'esri/symbols/PointSymbol3D',
    'esri/symbols/ObjectSymbol3DLayer',
    'esri/symbols/LineSymbol3D',
    'esri/symbols/PathSymbol3DLayer',
    'esri/layers/GraphicsLayer',
    'esri/tasks/support/Query',
    'esri/tasks/QueryTask',
    'esri/views/SceneView',
    'dojo/domReady!'
],
function (
    Map,
    Graphic,
    Color,
    Point,
    geometryEngine,
    webMercatorUtils,
    PointSymbol3D,
    ObjectSymbol3DLayer,
    LineSymbol3D,
    PathSymbol3DLayer,
    GraphicsLayer,
    Query,
    QueryTask,
    SceneView
    ) {
    $(document).ready(function () {
        // Enforce strict mode
        'use strict';

        // jQuery functions
        $.fn.scrollToView = function () {
            return $.each(this, function () {
                if ($(this).position().top < 0 ||
                    $(this).position().top + $(this).height() > $(this).parent().height()) {
                    $(this).parent().animate({
                        scrollTop: $(this).parent().scrollTop() + $(this).position().top
                    }, {
                        duration: 300,
                        queue: false
                    });
                }
            });
        };
        $.fn.debounce = function (on, func, threshold) {
            var debounce = function (func, threshold, execAsap) {
                var timeout;
                return function debounced() {
                    var obj = this;
                    var args = arguments;
                    function delayed() {
                        if (!execAsap) {
                            func.apply(obj, args);
                        }
                        timeout = null;
                    }
                    if (timeout) {
                        clearTimeout(timeout);
                    }
                    else if (execAsap) {
                        func.apply(obj, args);
                    }
                    timeout = setTimeout(delayed, threshold || 100);
                };
            };
            $(this).on(on, debounce(func, threshold));
        };
        $.fn.bringToFont = function (selector) {
            var max = Math.max.apply(null, $(this).siblings(selector).map(function () {
                return $(this).zIndex();
            }));
            $(this).zIndex(++max);
            return this;
        };
        $.format = function (f, e) {
            $.each(e, function (i) {
                f = f.replace(new RegExp('\\{' + i + '\\}', 'gm'), this);
            });
            return f;
        };
        $.zeroPad = function (s, len) {
            var t = s.toString();
            while (t.length < len) {
                t = '0' + t;
            }
            return t;
        };
        $.dms = function (d, lng) {
            var dir = d < 0 ? lng ? 'W' : 'S' : lng ? 'E' : 'N';
            var deg = 0 | (d < 0 ? d = - d : d);
            var min = 0 | d % 1 * 60;
            var sec = (0 | d * 60 % 1 * 60);
            return $.format('{0}° {1}\' {2}" {3}', [deg, $.zeroPad(min, 2), $.zeroPad(sec, 2), dir]);
        };

        var CABLES = 'http://services.arcgis.com/6DIQcwlPy8knb6sg/arcgis/rest/services/SubmarineCables/FeatureServer/2';
        var CITIES = 'http://services.arcgis.com/6DIQcwlPy8knb6sg/arcgis/rest/services/SubmarineCables/FeatureServer/1';
        var LINKS  = 'http://services.arcgis.com/6DIQcwlPy8knb6sg/arcgis/rest/services/SubmarineCables/FeatureServer/3';

        var OFFSET = 30000;
        var PIPE_SIZE = 25000;
        var CITY_SIZE = 50000;
        var DENSIFICATION = 1000000;
        var GEOMETRYPRECISION = 3;

        var _years = null;
        var _links = null;

        var _current = 0;
        var _history = [{
            type: 'home',
            id: null
        }];
                
        // Create map and view
        var _view = new SceneView({
            container: 'map',
            map: new Map({
                basemap: 'satellite',
                layers: [
                    new GraphicsLayer({
                        id: 'cables',
                        elevationInfo: {
                            mode: 'relativeToGround',
                            offset: OFFSET
                        }
                    }),
                    new GraphicsLayer({
                        id: 'cities',
                        elevationInfo: {
                            mode: 'relativeToGround',
                            offset: OFFSET
                        }
                    })
                ]
            }),
            center: [40, 22],
            environment: {
                lighting: {
                    date: null,
                    directShadows: false,
                    ambientOcclusion: false
                },
                atmosphere: {
                    enabled: 'default'
                },
                stars: 'default'
            }
        });
        _view.then(function () {
            // When the cables and cities have download, proceed to update the UI and render the cables.
            $.when(downloadYears(), downloadCables(), downloadCities(), downloadLinks()).done(function () {
                openItem();
                updateUI();
            });
        });
        _view.on('click', function (e) {
            // Exit if nothing found
            if (!e || !e.graphic) { return; }

            // Reject if graphic not visible
            if (!e.graphic.visible) { return; }

            // Zoom to cable
            if (_view.map.getLayer('cables').graphics.indexOf(e.graphic) !== -1) {
                navigateItem({
                    type: 'cable',
                    id: e.graphic.attributes.cable_id
                });
            } else if (_view.map.getLayer('cities').graphics.indexOf(e.graphic) !== -1) {
                navigateItem({
                    type: 'city',
                    id: e.graphic.attributes.city_id
                });
            }
        });

        $('#navigate-previous').click(function () {
            _current--;
            openItem();
            updateUI();
        });
        $('#navigate-next').click(function () {
            _current++;
            openItem();
            updateUI();
        });
        $('#navigate-home').click(function () {
            navigateItem({
                type: 'home',
                id: null
            });
        });
        $('#search').keypress(function (e) {
            // Process input only when the return key is pressed
            if (e.which !== 13) {
                return;
            }

            // Prevent event propagation
            e.preventDefault();

            // Check search string and then open search page
            var search = $('#search').val().trim();
            if (!search) { return;}
            navigateItem({
                type: 'search',
                id: search
            });
        });
        $('#button-info').click(function () {
            $('#panel-info').show();
        });
        $('#close-panel-info').click(function () {
            $('#panel-info').hide();
        });
        $('a').attr('target', '_blank');

        function downloadYears() {
            var defer = new $.Deferred();
            var query = new Query({
                where: '1=1',
                returnDistinctValues: true,
                returnGeometry: false,
                outFields: ['year'],
                orderByFields: ['year ASC']
            });
            var queryTask = new QueryTask({
                url: CABLES
            });
            queryTask.execute(query).then(function (r) {
                _years = r.features.map(function (e) {
                    return e.attributes.year;
                }).filter(function (e) {
                    return e !== null;
                });
                defer.resolve();
            });
            return defer.promise();
        }
        function downloadCables() {
            var defer = new $.Deferred();
            var query = new Query({
                returnGeometry: true,
                geometryPrecision: GEOMETRYPRECISION,
                outFields: ['Name', 'cable_id', 'color', 'length', 'owners', 'url', 'year'],
                orderByFields: ['Name'],
                where: '1=1'
            });
            var queryTask = new QueryTask({
                url: CABLES
            });
            queryTask.execute(query).then(function (r) {
                _view.map.getLayer('cables').add(
                    r.features.map(function (e) {
                        return new Graphic({
                            attributes: e.attributes,
                            geometry: geometryEngine.geodesicDensify(e.geometry, DENSIFICATION, 'meters'),
                            symbol: new LineSymbol3D({
                                symbolLayers: [
                                    new PathSymbol3DLayer({
                                        size: PIPE_SIZE,
                                        material: {
                                            color: e.attributes.color
                                        }
                                    })
                                ]
                            })
                        });
                    })
                );
                defer.resolve();
            });
            return defer.promise();
        }
        function downloadCities() {
            var defer = new $.Deferred();
            var query = new Query({
                where: '1=1',
                returnGeometry: true,
                geometryPrecision: GEOMETRYPRECISION,
                outFields: ['Name', 'city_id'],
                orderByFields: ['Name']
            });
            var queryTask = new QueryTask({
                url: CITIES
            });
            queryTask.execute(query).then(function (r) {
                _view.map.getLayer('cities').add(
                    r.features.map(function (e) {
                        return new Graphic({
                            attributes: e.attributes,
                            geometry: e.geometry,
                            symbol: new PointSymbol3D({
                                symbolLayers: [
                                    new ObjectSymbol3DLayer({
                                        height: CITY_SIZE,
                                        width: CITY_SIZE,
                                        resource: {
                                            primitive: 'sphere'
                                        },
                                        material: {
                                            color: 'white'
                                        }
                                    })
                                ]
                            })
                        });
                    })
                );
                defer.resolve();
            });
            return defer.promise();
        }
        function downloadLinks() {
            var defer = new $.Deferred();
            var query = new Query({
                returnGeometry: false,
                outFields: ['city_id', 'cable_id'],
                where: '1=1'
            });
            var queryTask = new QueryTask({
                url: LINKS
            });
            queryTask.execute(query).then(function (r) {
                _links = r.features.map(function (e) {
                    return {
                        city: e.attributes.city_id,
                        cable: e.attributes.cable_id
                    };
                });
                defer.resolve();
            });
            return defer.promise();
        }
        function navigateItem(item) {
            if (_current !== _history.length - 1) {
                _history.splice(_current + 1, _history.length);
            }
            _history.push(item);
            _current = _history.length - 1;
            openItem();
            updateUI();
        }
        function updateUI() {
            // Enable/disable previous button
            if (_history.length > 1 && _current > 0) {
                $('#navigate-previous').removeAttr('disabled');
            } else {
                $('#navigate-previous').attr('disabled', 'disabled');
            }

            // Enable/disable next button
            if (_history.length > 1 && _current < _history.length-1) {
                $('#navigate-next').removeAttr('disabled');
            } else {
                $('#navigate-next').attr('disabled', 'disabled');
            }
        }
        function openItem() {
            var item = _history[_current];
            switch (item.type) {
                case 'home':
                    openHome();
                    break;
                case 'year':
                    openYear(item.id);
                    break;
                case 'cable':
                    openCable(item.id);
                    break;
                case 'city':
                    openCity(item.id);
                    break;
                case 'search':
                    openSearch(item.id);
                    break;
            }
        }
        function openHome() {
            // Show/hide panels
            $('#page-home').show();
            $('#page-year').hide();
            $('#page-cable').hide();
            $('#page-city').hide();
            $('#page-search').hide();

            // List all years of cable installation
            $('#home-years').empty();
            _years.forEach(function (e) {
                $('#home-years').append(
                    $(document.createElement('div')).addClass('rc-link').data({ id: e }).html(e).click(function () {
                        navigateItem({
                            type: 'year',
                            id: $(this).data().id
                        });
                    })
                );
            });

            // Render all cables
            $('#home-cables').empty();
            _view.map.getLayer('cables').graphics.forEach(function (item) {
                // Make graphic visible
                item.visible = true;

                // Add entry to table
                $('#home-cables').append(
                    $(document.createElement('li')).addClass('list-group-item').append(
                        $(document.createElement('div')).addClass('rc-item').data({ id: item.attributes.cable_id }).html(item.attributes.Name).click(function () {
                            navigateItem({
                                type: 'cable',
                                id: $(this).data().id
                            });
                        })
                    )
                );
            });

            // Render all cities
            $('#home-cities').empty();
            _view.map.getLayer('cities').graphics.forEach(function (item) {
                // Make graphic visible
                item.visible = true;

                // Add entry to table
                $('#home-cities').append(
                    $(document.createElement('li')).addClass('list-group-item').append(
                        $(document.createElement('div')).addClass('rc-item').data({ id: item.attributes.city_id }).html(item.attributes.Name).click(function () {
                            navigateItem({
                                type: 'city',
                                id: $(this).data().id
                            });
                        })
                    )
                );
            });
        }       
        function openYear(id) {
            // Show "year" page
            $('#page-home').hide();
            $('#page-year').show();
            $('#page-cable').hide();
            $('#page-city').hide();
            $('#page-search').hide();

            // Clear cables list
            $('#year-cables').empty();

            // Find all cables installed in parsed year
            _view.map.getLayer('cables').graphics.forEach(function (item) {
                item.visible = item.attributes.year === id;
            });

            // Zoom to cables
            var cables = _view.map.getLayer('cables').graphics.filter(function (item) {
                return item.visible;
            }).getAll();
            _view.animateTo(cables);

            // Get selected cables and cities
            var cities =[];
            _view.map.getLayer('cables').graphics.filter(function (item) {
                return item.visible;
            }).forEach(function (item) { 
                // Get cities
                _links.forEach(function (e) {
                    if (e.cable === item.attributes.cable_id) {
                        if (cities.indexOf(e.city) === -1) {
                            cities.push(e.city);
                        }
                    }
                });

                // List cable
                $('#year-cables').append(
                    $(document.createElement('li')).addClass('list-group-item').append(
                        $(document.createElement('div')).addClass('rc-item').data({ id: item.attributes.cable_id }).html(item.attributes.Name).click(function () {
                            navigateItem({
                                type: 'cable',
                                id: $(this).data().id
                            });
                        })
                    )
                );
            });

            // Draw cities
            _view.map.getLayer('cities').graphics.forEach(function (item) {
                item.visible = cities.indexOf(item.attributes.city_id) !== -1;
            });
        }
        function openCable(id) {
            // Show cable page
            $('#page-home').hide();
            $('#page-year').hide();
            $('#page-cable').show();
            $('#page-city').hide();
            $('#page-search').hide();

            // Show only selected cable
            _view.map.getLayer('cables').graphics.forEach(function (item) {
                item.visible = item.attributes.cable_id === id;
            });

            // Get stored cable graphic from id
            var cable = _view.map.getLayer('cables').graphics.find(function (item) {
                return item.attributes.cable_id === id;
            });
            if (cable === undefined) { return; }

            // Zoom to cable
            _view.animateTo(cable);

            // Update cable elements on page
            $('#cable-name').html(cable.attributes.Name);
            $('#cable-owner').html(cable.attributes.owners);
            $('#cable-url').attr('href', function () {
                return cable.attributes.url === null ? '#' : cable.attributes.url;
            }).html(function () {
                return cable.attributes.url === null ? 'none' : cable.attributes.url;
            });
            $('#cable-length').html(cable.attributes.length);
            $('#cable-year').data({ id: cable.attributes.year }).html(cable.attributes.year).click(function () {
                navigateItem({
                    type: 'year',
                    id: $(this).data().id
                });
            });
            
            // Find all cities linked to this cable
            var cities = [];
            _links.filter(function (e) {
                return e.cable === id;
            }).forEach(function (e) {
                if (cities.indexOf(e.city) === -1) {
                    cities.push(e.city);
                }
            });

            // Add each city (or "landing point") as a list item
            _view.map.getLayer('cities').graphics.forEach(function (item) {
                item.visible = cities.indexOf(item.attributes.city_id) !== -1;
            });

            // Populate landing points table
            $('#cable-cities').empty();
            _view.map.getLayer('cities').graphics.filter(function (item) {
                return item.visible;
            }).getAll().sort(function (a, b) {
                return a.attributes.Name.localeCompare(b.attributes.Name);
            }).forEach(function (item) {
                $('#cable-cities').append(
                    $(document.createElement('li')).addClass('list-group-item').append(
                        $(document.createElement('div')).addClass('rc-item').data({ id: item.attributes.city_id }).html(item.attributes.Name).click(function () {
                            navigateItem({
                                type: 'city',
                                id: $(this).data().id
                            });
                        })
                    )
                );
            });
        }
        function openCity(id) {
            // Show city page
            $('#page-home').hide();
            $('#page-year').hide();
            $('#page-cable').hide();
            $('#page-city').show();
            $('#page-search').hide();

            // Show only selected cities
            _view.map.getLayer('cities').graphics.forEach(function (item) {
                item.visible = item.attributes.city_id === id;
            });

            // Get stored city graphic from id
            var city = _view.map.getLayer('cities').graphics.find(function (item) {
                return item.attributes.city_id === id;
            });

            // Convert location to lat/long
            var m = webMercatorUtils.webMercatorToGeographic(city.geometry);

            // Update city elements on page
            $('#city-name').html(city.attributes.Name);
            $('#city-lat').html($.dms(m.y), false);
            $('#city-long').html($.dms(m.x), true);

            // Find all cables linked to this city
            var cables = [];
            _links.filter(function (e) {
                return e.city === id;
            }).forEach(function (e) {
                if (cables.indexOf(e.cable) === -1) {
                    cables.push(e.cable);
                }
            });

            // Render selected cables
            _view.map.getLayer('cables').graphics.forEach(function (item) {
                item.visible = cables.indexOf(item.attributes.cable_id) !== -1;
            });

            var cables2 = _view.map.getLayer('cables').graphics.filter(function (item) {
                return item.visible;
            }).getAll();

            // Zoom to cables
            _view.animateTo(cables2);

            // Populate cable table
            $('#city-cables').empty();
            cables2.sort(function (a, b) {
                return a.attributes.Name.localeCompare(b.attributes.Name);
            }).forEach(function (item) {
                $('#city-cables').append(
                    $(document.createElement('li')).addClass('list-group-item').append(
                        $(document.createElement('div')).addClass('rc-item').data({ id: item.attributes.cable_id }).html(item.attributes.Name).click(function () {
                            navigateItem({
                                type: 'cable',
                                id: $(this).data().id
                            });
                        })
                    )
                );
            });
        }
        function openSearch(id) {
            // Show/hide panels
            $('#page-home').hide();
            $('#page-year').hide();
            $('#page-cable').hide();
            $('#page-city').hide();
            $('#page-search').show();

            // Render selected cables
            _view.map.getLayer('cables').graphics.forEach(function (item) {
                item.visible = item.attributes.Name.substr(0, id.length).toLocaleLowerCase() === id.toLocaleLowerCase();
            });

            // Clear cables lists
            $('#search-cables').empty();

            var cables = _view.map.getLayer('cables').graphics.filter(function (item) {
                return item.visible;
            }).getAll();

            // Get all selected cables, sort and then add to list
            cables.sort(function (a, b) {
                return a.attributes.Name.localeCompare(b.attributes.Name);
            }).forEach(function (item) {
                $('#search-cables').append(
                    $(document.createElement('li')).addClass('list-group-item').append(
                        $(document.createElement('div')).addClass('rc-item').data({ id: item.attributes.cable_id }).html(item.attributes.Name).click(function () {
                            navigateItem({
                                type: 'cable',
                                id: $(this).data().id
                            });
                        })
                    )
                );
            });


            // Add each city (or "landing point") as a list item
            _view.map.getLayer('cities').graphics.forEach(function (item) {
                item.visible = item.attributes.Name.substr(0, id.length).toLocaleLowerCase() === id.toLocaleLowerCase();
            });

            var cities = _view.map.getLayer('cities').graphics.filter(function (item) {
                return item.visible;
            }).getAll();

            // Populate landing points table
            $('#search-cities').empty();
            cities.sort(function (a, b) {
                return a.attributes.Name.localeCompare(b.attributes.Name);
            }).forEach(function (item) {
                $('#search-cities').append(
                    $(document.createElement('li')).addClass('list-group-item').append(
                        $(document.createElement('div')).addClass('rc-item').data({ id: item.attributes.city_id }).html(item.attributes.Name).click(function () {
                            navigateItem({
                                type: 'city',
                                id: $(this).data().id
                            });
                        })
                    )
                );
            });

            // Zoom to cables/city
            _view.animateTo([].concat.call(cables, cities));
        }
    });
});

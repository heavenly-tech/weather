Local WRF layout. Paths come from the environment. Nothing here is a machine path.

Infrastructure prepares, on omarchibald, the `ncar/iwrf` image and a static geogrid tree: 30-second topography, land use, and soil, cropped to this domain plus `geog_pad_deg` from `domain.json`, with low-resolution vegetation. The orchestrator reads that tree from `WRF_GEOG_DIR`.

`WRF_NAMELIST_WPS` and `WRF_NAMELIST_INPUT` are the templates in this directory. `WRF_GFS_DIR` holds the NOMADS GFS 0.25 GRIB files. `WRF_WORK_DIR` is the WPS/WRF run, including the cached `geo_em.d01.nc`. `WRF_OUTPUT_DIR` receives `wrfout*` and `latest.json`, which the Rust server reads. `WRF_IMAGE` defaults to `ncar/iwrf`.

The 1 km nest in `domain.json` is a hook only. `nest_1km.enabled` stays false, and `WRF_NEST_1KM=1` stops before a download. No scheduler is installed. One cycle runs only when the command is invoked on `omarchibald` or the Mac mini (`WRF_ALLOWED_HOSTS`).

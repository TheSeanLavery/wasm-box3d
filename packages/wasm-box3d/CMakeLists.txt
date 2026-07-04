cmake_minimum_required(VERSION 3.22)

project(wasm-box3d VERSION 0.1.2 LANGUAGES C)

set(BOX3D_VALIDATE OFF CACHE BOOL "Disable heavy Box3D validation for package builds" FORCE)
set(BOX3D_DISABLE_SIMD OFF CACHE BOOL "Use upstream SIMD defaults when available" FORCE)
option(WB3_ENABLE_PTHREADS "Build the pthread-enabled WASM variant" OFF)
option(WB3_ENABLE_MEMORY64 "Build WASM with 64-bit pointers for high-memory stress scenes" ON)
set(WB3_PTHREAD_POOL_SIZE "12" CACHE STRING "Emscripten pthread pool size for the threaded WASM variant")

add_subdirectory(../../vendor/box3d/src box3d)
if(EMSCRIPTEN AND WB3_ENABLE_MEMORY64)
	target_compile_options(box3d PRIVATE -m64)
endif()
if(EMSCRIPTEN AND WB3_ENABLE_PTHREADS)
	target_compile_definitions(box3d PRIVATE WB3_PTHREADS_ENABLED=1)
	target_compile_options(box3d PRIVATE -pthread)
	target_link_options(box3d PRIVATE -pthread)
endif()

add_executable(box3d_wasm wasm/wasm_box3d.c)
target_link_libraries(box3d_wasm PRIVATE box3d)
target_include_directories(box3d_wasm PRIVATE ../../vendor/box3d/include ../../vendor/box3d/src)
if(EMSCRIPTEN AND WB3_ENABLE_MEMORY64)
	target_compile_options(box3d_wasm PRIVATE -m64)
endif()
if(EMSCRIPTEN AND WB3_ENABLE_PTHREADS)
	target_compile_definitions(box3d_wasm PRIVATE WB3_PTHREADS_ENABLED=1)
	target_compile_options(box3d_wasm PRIVATE -pthread)
endif()
if(WB3_ENABLE_PTHREADS)
	set(WB3_OUTPUT_NAME "box3d-wasm-pthreads")
else()
	set(WB3_OUTPUT_NAME "box3d-wasm")
endif()
set_target_properties(box3d_wasm PROPERTIES
	C_STANDARD 17
	C_STANDARD_REQUIRED YES
	OUTPUT_NAME "${WB3_OUTPUT_NAME}"
	RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/dist/wasm"
)

if(EMSCRIPTEN)
	set(WB3_LINK_OPTIONS
		-sMODULARIZE=1
		-sEXPORT_ES6=1
		-sEXPORT_NAME=Box3DModule
		-sENVIRONMENT=web,worker
		-sALLOW_MEMORY_GROWTH=1
		-sMAXIMUM_MEMORY=16GB
		-sMEMORY_GROWTH_LINEAR_STEP=512MB
		-sFILESYSTEM=0
		-sASSERTIONS=1
		-sEXPORTED_RUNTIME_METHODS=['cwrap','HEAPF32']
		-sEXPORTED_FUNCTIONS=['_wb3_reset','_wb3_reset_stress','_wb3_reset_arena','_wb3_step','_wb3_sync_render_data','_wb3_rebuild_dynamic_tree','_wb3_spawn_box','_wb3_spawn_box_ex','_wb3_spawn_box_ex_no_sync','_wb3_spawn_sphere','_wb3_spawn_sphere_ex','_wb3_spawn_sphere_ex_no_sync','_wb3_set_gravity_enabled','_wb3_set_performance_options','_wb3_force_sleep_awake_bodies','_wb3_sleep_quiet_regions','_wb3_get_body_count','_wb3_get_awake_body_count','_wb3_get_contact_count','_wb3_get_awake_contact_count','_wb3_get_island_count','_wb3_get_task_count','_wb3_get_stack_used','_wb3_get_actual_worker_count','_wb3_get_stress_layout','_wb3_get_sleep_policy','_wb3_get_continuous_enabled','_wb3_get_body_stride','_wb3_get_profile_stride','_wb3_get_body_data','_wb3_get_profile_data','_wb3_get_step_count','_wb3_get_stress_dynamic_count','_wb3_get_last_stress_request','_wb3_get_max_bodies']
	)
	if(WB3_ENABLE_PTHREADS)
		list(APPEND WB3_LINK_OPTIONS
			-pthread
			-sUSE_PTHREADS=1
			-sPTHREAD_POOL_SIZE=${WB3_PTHREAD_POOL_SIZE}
		)
	endif()
	if(WB3_ENABLE_MEMORY64)
		list(APPEND WB3_LINK_OPTIONS -m64)
	endif()
	target_link_options(box3d_wasm PRIVATE ${WB3_LINK_OPTIONS})
endif()

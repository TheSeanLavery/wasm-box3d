cmake_minimum_required(VERSION 3.22)

project(wasm-box3d VERSION 0.1.1 LANGUAGES C)

set(BOX3D_VALIDATE OFF CACHE BOOL "Disable heavy Box3D validation for package builds" FORCE)
set(BOX3D_DISABLE_SIMD OFF CACHE BOOL "Use upstream SIMD defaults when available" FORCE)

add_subdirectory(../../vendor/box3d/src box3d)

add_executable(box3d_wasm wasm/wasm_box3d.c)
target_link_libraries(box3d_wasm PRIVATE box3d)
target_include_directories(box3d_wasm PRIVATE ../../vendor/box3d/include)
set_target_properties(box3d_wasm PROPERTIES
	C_STANDARD 17
	C_STANDARD_REQUIRED YES
	OUTPUT_NAME "box3d-wasm"
	RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/dist/wasm"
)

if(EMSCRIPTEN)
	target_link_options(box3d_wasm PRIVATE
		-sMODULARIZE=1
		-sEXPORT_ES6=1
		-sEXPORT_NAME=Box3DModule
		-sENVIRONMENT=web
		-sALLOW_MEMORY_GROWTH=1
		-sFILESYSTEM=0
		-sASSERTIONS=1
		-sEXPORTED_RUNTIME_METHODS=['cwrap','HEAPF32']
		-sEXPORTED_FUNCTIONS=['_wb3_reset','_wb3_reset_stress','_wb3_step','_wb3_spawn_box','_wb3_spawn_sphere','_wb3_set_gravity_enabled','_wb3_get_body_count','_wb3_get_body_stride','_wb3_get_body_data','_wb3_get_step_count','_wb3_get_stress_dynamic_count','_wb3_get_last_stress_request','_wb3_get_max_bodies']
	)
endif()

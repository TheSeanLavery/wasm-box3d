// SPDX-FileCopyrightText: 2026
// SPDX-License-Identifier: MIT

#include "box3d/box3d.h"

#if defined( __EMSCRIPTEN__ )
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define MAX_RENDER_BODIES 10000000
#define BODY_FLOAT_STRIDE 14
#define DEFAULT_ARENA_HALF_WIDTH 14.0f
#define WB3_SLEEP_THRESHOLD 0.08f
#if defined( WB3_PTHREADS_ENABLED )
#define WB3_WORKER_COUNT 4
#else
#define WB3_WORKER_COUNT 1
#endif

enum
{
	RENDER_BOX = 0,
	RENDER_SPHERE = 1,
};

typedef struct RenderBody
{
	b3BodyId bodyId;
	int shapeType;
	float hx;
	float hy;
	float hz;
	float radius;
	float r;
	float g;
	float b;
} RenderBody;

static b3WorldId g_worldId = B3_NULL_ID;
static RenderBody* g_bodies = NULL;
static float* g_bodyFloats = NULL;
static int g_bodyCapacity = 0;
static int g_bodyCount = 0;
static int g_stepCount = 0;
static int g_sceneIndex = 0;
static int g_lastStressRequested = 0;
static int g_lastStressDynamicCount = 0;
static bool g_gravityEnabled = true;

static int clamp_stress_dynamic_count( int requestedDynamicCount )
{
	int maxDynamicCount = MAX_RENDER_BODIES - 5;
	if ( requestedDynamicCount < 1 )
	{
		return 1;
	}
	if ( requestedDynamicCount > maxDynamicCount )
	{
		return maxDynamicCount;
	}
	return requestedDynamicCount;
}

static void clear_world( void )
{
	if ( b3World_IsValid( g_worldId ) )
	{
		b3DestroyWorld( g_worldId );
	}

	g_worldId = b3_nullWorldId;
	g_bodyCount = 0;
	g_stepCount = 0;
}

static bool ensure_body_capacity( int requiredCapacity )
{
	if ( requiredCapacity <= g_bodyCapacity )
	{
		return true;
	}

	int nextCapacity = g_bodyCapacity == 0 ? 256 : g_bodyCapacity;
	while ( nextCapacity < requiredCapacity && nextCapacity < MAX_RENDER_BODIES )
	{
		nextCapacity *= 2;
		if ( nextCapacity < 0 || nextCapacity > MAX_RENDER_BODIES )
		{
			nextCapacity = MAX_RENDER_BODIES;
		}
	}

	RenderBody* nextBodies = (RenderBody*)malloc( sizeof( RenderBody ) * (size_t)nextCapacity );
	if ( nextBodies == NULL )
	{
		return false;
	}

	float* nextBodyFloats = (float*)malloc( sizeof( float ) * (size_t)nextCapacity * BODY_FLOAT_STRIDE );
	if ( nextBodyFloats == NULL )
	{
		free( nextBodies );
		return false;
	}

	if ( g_bodyCapacity > 0 )
	{
		memcpy( nextBodies, g_bodies, sizeof( RenderBody ) * (size_t)g_bodyCount );
		memcpy( nextBodyFloats, g_bodyFloats, sizeof( float ) * (size_t)g_bodyCount * BODY_FLOAT_STRIDE );
	}

	free( g_bodies );
	free( g_bodyFloats );
	g_bodies = nextBodies;
	g_bodyFloats = nextBodyFloats;
	g_bodyCapacity = nextCapacity;
	return true;
}

static int add_oriented_box( b3BodyType type, b3Vec3 position, b3Vec3 halfExtents, float density, b3Vec3 color,
							 b3Vec3 velocity, b3Quat rotation )
{
	if ( g_bodyCount >= MAX_RENDER_BODIES || ensure_body_capacity( g_bodyCount + 1 ) == false )
	{
		return -1;
	}

	b3BodyDef bodyDef = b3DefaultBodyDef();
	bodyDef.type = type;
	bodyDef.position = (b3Pos){ position.x, position.y, position.z };
	bodyDef.rotation = rotation;
	bodyDef.linearVelocity = velocity;
	if ( type == b3_dynamicBody )
	{
		bodyDef.sleepThreshold = WB3_SLEEP_THRESHOLD;
	}

	b3BodyId bodyId = b3CreateBody( g_worldId, &bodyDef );
	b3ShapeDef shapeDef = b3DefaultShapeDef();
	shapeDef.density = density;
	shapeDef.baseMaterial.friction = 0.62f;
	shapeDef.baseMaterial.restitution = type == b3_dynamicBody ? 0.08f : 0.0f;

	b3BoxHull hull = b3MakeBoxHull( halfExtents.x, halfExtents.y, halfExtents.z );
	b3CreateHullShape( bodyId, &shapeDef, &hull.base );

	RenderBody* renderBody = g_bodies + g_bodyCount;
	renderBody->bodyId = bodyId;
	renderBody->shapeType = RENDER_BOX;
	renderBody->hx = halfExtents.x;
	renderBody->hy = halfExtents.y;
	renderBody->hz = halfExtents.z;
	renderBody->radius = 0.0f;
	renderBody->r = color.x;
	renderBody->g = color.y;
	renderBody->b = color.z;

	return g_bodyCount++;
}

static int add_box( b3BodyType type, b3Vec3 position, b3Vec3 halfExtents, float density, b3Vec3 color, b3Vec3 velocity )
{
	return add_oriented_box( type, position, halfExtents, density, color, velocity, b3Quat_identity );
}

static int add_sphere( b3BodyType type, b3Vec3 position, float radius, float density, b3Vec3 color, b3Vec3 velocity )
{
	if ( g_bodyCount >= MAX_RENDER_BODIES || ensure_body_capacity( g_bodyCount + 1 ) == false )
	{
		return -1;
	}

	b3BodyDef bodyDef = b3DefaultBodyDef();
	bodyDef.type = type;
	bodyDef.position = (b3Pos){ position.x, position.y, position.z };
	bodyDef.linearVelocity = velocity;
	if ( type == b3_dynamicBody )
	{
		bodyDef.sleepThreshold = WB3_SLEEP_THRESHOLD;
	}

	b3BodyId bodyId = b3CreateBody( g_worldId, &bodyDef );
	b3ShapeDef shapeDef = b3DefaultShapeDef();
	shapeDef.density = density;
	shapeDef.baseMaterial.friction = 0.45f;
	shapeDef.baseMaterial.restitution = 0.18f;

	b3Sphere sphere = { b3Vec3_zero, radius };
	b3CreateSphereShape( bodyId, &shapeDef, &sphere );

	RenderBody* renderBody = g_bodies + g_bodyCount;
	renderBody->bodyId = bodyId;
	renderBody->shapeType = RENDER_SPHERE;
	renderBody->hx = radius;
	renderBody->hy = radius;
	renderBody->hz = radius;
	renderBody->radius = radius;
	renderBody->r = color.x;
	renderBody->g = color.y;
	renderBody->b = color.z;

	return g_bodyCount++;
}

static void add_sized_bounds( float halfWidth, float wallCenterY, float wallHalfHeight )
{
	add_box( b3_staticBody, (b3Vec3){ 0.0f, -0.55f, 0.0f }, (b3Vec3){ halfWidth, 0.5f, halfWidth }, 0.0f,
			 (b3Vec3){ 0.33f, 0.36f, 0.40f }, b3Vec3_zero );
	add_box( b3_staticBody, (b3Vec3){ -halfWidth - 0.25f, wallCenterY, 0.0f }, (b3Vec3){ 0.25f, wallHalfHeight, halfWidth },
			 0.0f,
			 (b3Vec3){ 0.24f, 0.27f, 0.31f }, b3Vec3_zero );
	add_box( b3_staticBody, (b3Vec3){ halfWidth + 0.25f, wallCenterY, 0.0f }, (b3Vec3){ 0.25f, wallHalfHeight, halfWidth },
			 0.0f,
			 (b3Vec3){ 0.24f, 0.27f, 0.31f }, b3Vec3_zero );
	add_box( b3_staticBody, (b3Vec3){ 0.0f, wallCenterY, -halfWidth - 0.25f }, (b3Vec3){ halfWidth, wallHalfHeight, 0.25f },
			 0.0f,
			 (b3Vec3){ 0.24f, 0.27f, 0.31f }, b3Vec3_zero );
	add_box( b3_staticBody, (b3Vec3){ 0.0f, wallCenterY, halfWidth + 0.25f }, (b3Vec3){ halfWidth, wallHalfHeight, 0.25f },
			 0.0f,
			 (b3Vec3){ 0.24f, 0.27f, 0.31f }, b3Vec3_zero );
}

static void add_bounds( void )
{
	add_sized_bounds( DEFAULT_ARENA_HALF_WIDTH, 3.0f, 3.6f );
}

static int ceil_sqrt_int( int value )
{
	int result = 1;
	while ( result * result < value )
	{
		result += 1;
	}
	return result;
}

static int add_stress_blocks( int requestedDynamicCount )
{
	requestedDynamicCount = clamp_stress_dynamic_count( requestedDynamicCount );

	const float horizontalSpacing = 0.76f;
	const float verticalSpacing = 0.74f;
	int footprint = ceil_sqrt_int( requestedDynamicCount );
	if ( footprint > 32 )
	{
		footprint = 32;
	}

	float halfWidth = ( (float)footprint * horizontalSpacing * 0.5f ) + 5.5f;
	if ( halfWidth < DEFAULT_ARENA_HALF_WIDTH )
	{
		halfWidth = DEFAULT_ARENA_HALF_WIDTH;
	}

	add_sized_bounds( halfWidth, 8.0f, 8.5f );

	int created = 0;
	for ( int y = 0; created < requestedDynamicCount; ++y )
	{
		for ( int z = 0; z < footprint && created < requestedDynamicCount; ++z )
		{
			for ( int x = 0; x < footprint && created < requestedDynamicCount; ++x )
			{
				float fx = ( (float)x - (float)( footprint - 1 ) * 0.5f ) * horizontalSpacing;
				float fz = ( (float)z - (float)( footprint - 1 ) * 0.5f ) * horizontalSpacing;
				float fy = 0.42f + (float)y * verticalSpacing;
				float tint = (float)( ( x * 17 + z * 31 + y * 13 ) % 100 ) / 100.0f;
				b3Vec3 color = { 0.18f + tint * 0.54f, 0.46f + tint * 0.28f, 0.72f - tint * 0.38f };

				if ( add_box( b3_dynamicBody, (b3Vec3){ fx, fy, fz }, (b3Vec3){ 0.34f, 0.34f, 0.34f }, 1.0f, color,
							  b3Vec3_zero ) < 0 )
				{
					return created;
				}
				created += 1;
			}
		}
	}

	return created;
}

static void add_stack_scene( void )
{
	add_bounds();

	const b3Vec3 colors[] = {
		{ 0.93f, 0.34f, 0.25f },
		{ 0.17f, 0.61f, 0.74f },
		{ 0.96f, 0.72f, 0.19f },
		{ 0.38f, 0.68f, 0.34f },
	};

	for ( int y = 0; y < 7; ++y )
	{
		for ( int x = 0; x < 5; ++x )
		{
			float jitter = ( ( x + y ) % 2 == 0 ) ? 0.08f : -0.08f;
			b3Vec3 p = { -2.4f + x * 1.2f + jitter, 0.55f + y * 1.08f, 0.0f };
			add_box( b3_dynamicBody, p, (b3Vec3){ 0.5f, 0.5f, 0.5f }, 1.0f, colors[( x + y ) % 4], b3Vec3_zero );
		}
	}
}

static void add_sphere_scene( void )
{
	add_bounds();

	for ( int i = 0; i < 42; ++i )
	{
		float x = -5.0f + (float)( i % 7 ) * 1.55f;
		float z = -3.8f + (float)( i / 7 ) * 1.25f;
		float y = 1.0f + (float)( i / 7 ) * 1.1f;
		float radius = 0.32f + 0.06f * (float)( i % 3 );
		b3Vec3 color = { 0.22f + 0.05f * (float)( i % 4 ), 0.44f + 0.06f * (float)( i % 5 ), 0.86f };
		add_sphere( b3_dynamicBody, (b3Vec3){ x, y, z }, radius, 1.0f, color, b3Vec3_zero );
	}
}

static void add_mixed_scene( void )
{
	add_bounds();
	add_box( b3_staticBody, (b3Vec3){ 0.0f, 1.0f, 0.0f }, (b3Vec3){ 3.3f, 0.18f, 2.2f }, 0.0f,
			 (b3Vec3){ 0.46f, 0.40f, 0.32f }, b3Vec3_zero );

	for ( int i = 0; i < 48; ++i )
	{
		float x = -4.8f + (float)( i % 8 ) * 1.35f;
		float z = -4.2f + (float)( ( i * 5 ) % 9 ) * 1.0f;
		float y = 5.0f + (float)( i / 8 ) * 0.85f;
		b3Vec3 velocity = { ( ( i % 2 ) ? -1.2f : 1.2f ), 0.0f, ( ( i % 3 ) - 1 ) * 0.55f };

		if ( i % 3 == 0 )
		{
			add_sphere( b3_dynamicBody, (b3Vec3){ x, y, z }, 0.42f, 1.0f, (b3Vec3){ 0.90f, 0.38f, 0.26f }, velocity );
		}
		else
		{
			add_box( b3_dynamicBody, (b3Vec3){ x, y, z }, (b3Vec3){ 0.34f, 0.47f, 0.34f }, 1.0f,
					 (b3Vec3){ 0.25f, 0.66f, 0.54f }, velocity );
		}
	}
}

static void sync_render_data( void )
{
	for ( int i = 0; i < g_bodyCount; ++i )
	{
		RenderBody* body = g_bodies + i;
		b3WorldTransform transform = b3Body_GetTransform( body->bodyId );
		float* out = g_bodyFloats + i * BODY_FLOAT_STRIDE;

		out[0] = (float)transform.p.x;
		out[1] = (float)transform.p.y;
		out[2] = (float)transform.p.z;
		out[3] = transform.q.v.x;
		out[4] = transform.q.v.y;
		out[5] = transform.q.v.z;
		out[6] = transform.q.s;
		out[7] = body->shapeType == RENDER_BOX ? body->hx * 2.0f : body->radius * 2.0f;
		out[8] = body->shapeType == RENDER_BOX ? body->hy * 2.0f : body->radius * 2.0f;
		out[9] = body->shapeType == RENDER_BOX ? body->hz * 2.0f : body->radius * 2.0f;
		out[10] = (float)body->shapeType;
		out[11] = body->r;
		out[12] = body->g;
		out[13] = body->b;
	}
}

EMSCRIPTEN_KEEPALIVE
int wb3_reset( int sceneIndex )
{
	clear_world();
	g_lastStressRequested = 0;
	g_lastStressDynamicCount = 0;

	b3WorldDef worldDef = b3DefaultWorldDef();
	worldDef.gravity = g_gravityEnabled ? (b3Vec3){ 0.0f, -10.0f, 0.0f } : b3Vec3_zero;
	worldDef.workerCount = WB3_WORKER_COUNT;
	g_worldId = b3CreateWorld( &worldDef );
	g_sceneIndex = sceneIndex % 3;

	if ( g_sceneIndex == 1 )
	{
		add_sphere_scene();
	}
	else if ( g_sceneIndex == 2 )
	{
		add_mixed_scene();
	}
	else
	{
		add_stack_scene();
	}

	sync_render_data();
	return g_bodyCount;
}

EMSCRIPTEN_KEEPALIVE
int wb3_reset_stress( int dynamicBlockCount )
{
	clear_world();

	b3WorldDef worldDef = b3DefaultWorldDef();
	worldDef.gravity = g_gravityEnabled ? (b3Vec3){ 0.0f, -10.0f, 0.0f } : b3Vec3_zero;
	worldDef.workerCount = WB3_WORKER_COUNT;
	g_worldId = b3CreateWorld( &worldDef );
	g_sceneIndex = 3;
	g_lastStressRequested = dynamicBlockCount;
	g_lastStressDynamicCount = add_stress_blocks( dynamicBlockCount );

	sync_render_data();
	return g_bodyCount;
}

EMSCRIPTEN_KEEPALIVE
int wb3_reset_arena( float halfWidth )
{
	clear_world();
	g_lastStressRequested = 0;
	g_lastStressDynamicCount = 0;

	b3WorldDef worldDef = b3DefaultWorldDef();
	worldDef.gravity = g_gravityEnabled ? (b3Vec3){ 0.0f, -10.0f, 0.0f } : b3Vec3_zero;
	worldDef.workerCount = WB3_WORKER_COUNT;
	g_worldId = b3CreateWorld( &worldDef );
	g_sceneIndex = 4;

	float clampedHalfWidth = halfWidth < DEFAULT_ARENA_HALF_WIDTH ? DEFAULT_ARENA_HALF_WIDTH : halfWidth;
	add_sized_bounds( clampedHalfWidth, 8.0f, 8.5f );
	sync_render_data();
	return g_bodyCount;
}

EMSCRIPTEN_KEEPALIVE
void wb3_step( float dt, int substeps )
{
	if ( b3World_IsValid( g_worldId ) == false )
	{
		return;
	}

	float step = dt;
	if ( step <= 0.0f || step > 0.05f )
	{
		step = 1.0f / 60.0f;
	}

	int solverSubsteps = substeps < 1 ? 1 : ( substeps > 16 ? 16 : substeps );
	b3World_Step( g_worldId, step, solverSubsteps );
	g_stepCount += 1;
}

EMSCRIPTEN_KEEPALIVE
void wb3_sync_render_data( void )
{
	if ( b3World_IsValid( g_worldId ) == false )
	{
		return;
	}

	sync_render_data();
}

EMSCRIPTEN_KEEPALIVE
int wb3_spawn_box( float x, float y, float z, float vx, float vy, float vz )
{
	if ( b3World_IsValid( g_worldId ) == false )
	{
		return -1;
	}

	int index = add_box( b3_dynamicBody, (b3Vec3){ x, y, z }, (b3Vec3){ 0.45f, 0.45f, 0.45f }, 1.0f,
						 (b3Vec3){ 0.94f, 0.60f, 0.22f }, (b3Vec3){ vx, vy, vz } );
	sync_render_data();
	return index;
}

static int spawn_box_ex( float x, float y, float z, float hx, float hy, float hz, float vx, float vy, float vz, float r,
						 float g, float b, int dynamic, float yaw, float density, bool shouldSyncRenderData )
{
	if ( b3World_IsValid( g_worldId ) == false )
	{
		return -1;
	}

	b3Vec3 halfExtents = {
		hx > 0.01f ? hx : 0.45f,
		hy > 0.01f ? hy : 0.45f,
		hz > 0.01f ? hz : 0.45f,
	};
	float shapeDensity = density > 0.0f ? density : 1.0f;
	b3BodyType type = dynamic != 0 ? b3_dynamicBody : b3_staticBody;
	b3Quat rotation = b3MakeQuatFromAxisAngle( b3Vec3_axisY, yaw );
	int index = add_oriented_box( type, (b3Vec3){ x, y, z }, halfExtents, shapeDensity, (b3Vec3){ r, g, b },
								  (b3Vec3){ vx, vy, vz }, rotation );
	if ( shouldSyncRenderData )
	{
		sync_render_data();
	}
	return index;
}

EMSCRIPTEN_KEEPALIVE
int wb3_spawn_box_ex( float x, float y, float z, float hx, float hy, float hz, float vx, float vy, float vz, float r,
					  float g, float b, int dynamic, float yaw, float density )
{
	return spawn_box_ex( x, y, z, hx, hy, hz, vx, vy, vz, r, g, b, dynamic, yaw, density, true );
}

EMSCRIPTEN_KEEPALIVE
int wb3_spawn_box_ex_no_sync( float x, float y, float z, float hx, float hy, float hz, float vx, float vy, float vz, float r,
							  float g, float b, int dynamic, float yaw, float density )
{
	return spawn_box_ex( x, y, z, hx, hy, hz, vx, vy, vz, r, g, b, dynamic, yaw, density, false );
}

EMSCRIPTEN_KEEPALIVE
int wb3_spawn_sphere( float x, float y, float z, float vx, float vy, float vz )
{
	if ( b3World_IsValid( g_worldId ) == false )
	{
		return -1;
	}

	int index = add_sphere( b3_dynamicBody, (b3Vec3){ x, y, z }, 0.45f, 1.0f, (b3Vec3){ 0.30f, 0.63f, 0.95f },
							(b3Vec3){ vx, vy, vz } );
	sync_render_data();
	return index;
}

EMSCRIPTEN_KEEPALIVE
void wb3_set_gravity_enabled( int enabled )
{
	g_gravityEnabled = enabled != 0;
	if ( b3World_IsValid( g_worldId ) )
	{
		b3World_SetGravity( g_worldId, g_gravityEnabled ? (b3Vec3){ 0.0f, -10.0f, 0.0f } : b3Vec3_zero );
	}
}

EMSCRIPTEN_KEEPALIVE
int wb3_force_sleep_awake_bodies( void )
{
	if ( b3World_IsValid( g_worldId ) == false )
	{
		return 0;
	}

	int sleptCount = 0;
	for ( int i = 0; i < g_bodyCount; ++i )
	{
		b3BodyId bodyId = g_bodies[i].bodyId;
		if ( b3Body_IsAwake( bodyId ) )
		{
			b3Body_SetAwake( bodyId, false );
			sleptCount += 1;
		}
	}

	return sleptCount;
}

EMSCRIPTEN_KEEPALIVE
int wb3_get_body_count( void )
{
	return g_bodyCount;
}

EMSCRIPTEN_KEEPALIVE
int wb3_get_awake_body_count( void )
{
	if ( b3World_IsValid( g_worldId ) == false )
	{
		return 0;
	}

	return b3World_GetAwakeBodyCount( g_worldId );
}

EMSCRIPTEN_KEEPALIVE
int wb3_get_body_stride( void )
{
	return BODY_FLOAT_STRIDE;
}

EMSCRIPTEN_KEEPALIVE
float* wb3_get_body_data( void )
{
	return g_bodyFloats;
}

EMSCRIPTEN_KEEPALIVE
int wb3_get_step_count( void )
{
	return g_stepCount;
}

EMSCRIPTEN_KEEPALIVE
int wb3_get_stress_dynamic_count( void )
{
	return g_lastStressDynamicCount;
}

EMSCRIPTEN_KEEPALIVE
int wb3_get_last_stress_request( void )
{
	return g_lastStressRequested;
}

EMSCRIPTEN_KEEPALIVE
int wb3_get_max_bodies( void )
{
	return MAX_RENDER_BODIES;
}

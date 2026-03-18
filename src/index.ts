/**
* vite-plugin-monitor: public package entry point.
* @packageDocumentation
*/

export { trackerPlugin } from './plugin/index'

export type {
	// Plugin configuration
	TrackerPluginOptions,
	TrackOptions,
	StorageMode,
	StorageOptions,
	HttpStorageOptions,
	WsStorageOptions,
	HttpTrackOptions,
	ConsoleTrackOptions,
	LoggingOptions,
	LogTransport,
	RotationOptions,
	DashboardOptions,
	OverlayOptions,
	// Core event types
	TrackerEvent,
	TrackerEventType,
	LogLevel,
	EventPayload,
	EventMeta,
	// Payload types
	ClickPayload,
	HttpPayload,
	ErrorPayload,
	NavigationPayload,
	ConsolePayload,
	ConsoleMethod,
	SerializedArg,
	CustomPayload,
	SessionPayload,
	// Public client API
	TrackEventOptions,
	SetUserOptions,
	ITrackerClient,
	IDebugOverlay,
	Tracker,
	// API contracts
	IngestRequest,
	EventsQuery,
	EventsResponse,
} from './types';

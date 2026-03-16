/**
* vite-plugin-monitor — public package entry point for vite-side.
* @packageDocumentation
*/

/* plugin factory */
export { trackerPlugin } from './plugin/index';

export type {
	// INFO Plugin configuration types
	TrackerPluginOptions,
	TrackOptions,
	StorageOptions,
	StorageMode,
	LoggingOptions,
	LogTransport,
	RotationOptions,
	DashboardOptions,
	OverlayOptions,
	HttpTrackOptions,
	ConsoleTrackOptions,
	// INFO Core event types
	TrackerEvent,
	TrackerEventType,
	LogLevel,
	EventPayload,
	EventMeta,
	// INFO Public tracker API types
	TrackEventOptions,
	SetUserOptions,
	// INFO Payload types
	ClickPayload,
	HttpPayload,
	ErrorPayload,
	NavigationPayload,
	PerformancePayload,
	ConsolePayload,
	ConsoleMethod,
	SerializedArg,
	CustomPayload,
	// INFO API contract types
	IngestRequest,
	EventsQuery,
	EventsResponse,
	// INFO Client types
	Tracker,
	TrackerConfig
} from './types';

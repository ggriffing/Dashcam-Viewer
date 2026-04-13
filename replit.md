# Tesla Dashcam Viewer

## Overview

A web application for viewing synchronized multi-angle Tesla dashcam footage with real-time telemetry overlay. The application parses Tesla dashcam MP4 files and extracts SEI (Supplemental Enhancement Information) metadata to display vehicle telemetry including speed, GPS coordinates, gear state, autopilot status, and steering angle. Users can load front, left, right, and rear camera feeds that play in synchronized 2x2 grid layout.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: React Query (TanStack Query) for server state, React hooks for local state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (dark mode only)
- **Build Tool**: Vite with hot module replacement

### Backend Architecture
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript with ES modules
- **Build**: esbuild for production bundling with selective dependency bundling
- **Static Serving**: Vite dev server in development, Express static middleware in production

### Video Processing Architecture
- **MP4 Parsing**: Custom DashcamMP4 class for parsing Tesla dashcam MP4 container format
- **Metadata Extraction**: Protobuf-based SEI metadata parsing using protobuf.js
- **Video Decoding**: WebCodecs VideoDecoder API for frame-by-frame rendering to canvas
- **File Handling**: JSZip for handling compressed dashcam archives, drag-and-drop file upload

### Key Design Decisions

1. **Client-Side Video Processing**: All video parsing and decoding happens in the browser using WebCodecs API, eliminating server-side video processing overhead.

2. **Frame-Based Playback**: Videos are decoded frame-by-frame rather than using native video elements, enabling precise synchronization across multiple camera angles and per-frame metadata access.

3. **Dark Mode Only**: The UI is designed exclusively for dark mode to match Tesla's aesthetic and reduce eye strain when viewing dashcam footage.

4. **Vendor Libraries**: External dependencies (protobuf.js, jszip, custom dashcam-mp4 parser) are loaded as vendor scripts rather than npm packages to reduce bundle size and avoid compatibility issues.

### Tesla Drive Browser
- **Primary Entry**: `TeslaDriveBrowser` component replaces the old DropZone as the main file loading UI
- **Directory Picker**: Uses File System Access API (`showDirectoryPicker`) to browse the Tesla flash drive
- **Drive Traversal**: `teslaDriveTraversal.ts` utility scans `TeslaCam/SavedClips|RecentClips|SentryClips` event folders
- **Event Browser**: Collapsible category sections, events listed newest-first, per-event camera checkboxes
- **Camera Detection**: Supports front, back, left_repeater, left_pillar, right_repeater, right_pillar; pillar cameras map to left/right slots
- **Drag-Drop Fallback**: Compact drag-and-drop zone at the bottom of the browser for manual MP4 file loading
- **Browser Support**: `showDirectoryPicker` requires Chrome or Edge (same browsers required for WebCodecs)

### Data Flow
1. User selects Tesla flash drive via directory picker, or drags MP4 files
2. Drive is scanned for TeslaCam folder structure; events listed by category/timestamp
3. User selects an event and checks desired camera angles, then clicks Load
4. Files are parsed using DashcamMP4 class to extract video frames and SEI metadata
5. Camera angle is auto-detected from filename patterns
6. Video frames are decoded using WebCodecs and rendered to canvas elements
7. SEI metadata is displayed in real-time telemetry HUD overlay

### Video Export Feature
- **Export Merged Video**: Users can export selected camera angles into a single MP4 video with telemetry overlay
- **Camera Selection**: Front camera is required; Left, Right, and Rear are optional
- **Layout Modes**: Single, dual-horizontal, dual-vertical, or 2x2 grid based on selected cameras
- **Fixed Grid Positions**: Front (top-left), Right (top-right), Left (bottom-left), Rear (bottom-right)
- **Telemetry HUD**: Embedded at bottom of exported video with speed, gear, autopilot, heading, steering, blinkers, brake, accelerator, GPS coordinates, and timestamp
- **Encoding**: Uses WebCodecs VideoEncoder API with mp4-muxer for client-side MP4 generation
- **Browser Support**: Requires WebCodecs API (Chrome, Edge, Firefox; not Safari)

## External Dependencies

### Database
- **PostgreSQL**: Configured via Drizzle ORM with drizzle-kit for schema management
- **Schema Location**: `shared/schema.ts` using Zod for validation
- **Connection**: DATABASE_URL environment variable required

### Third-Party Libraries (Client-Side)
- **protobuf.js**: Protocol Buffer parsing for Tesla SEI metadata format
- **JSZip**: ZIP file extraction for dashcam archive support
- **DashcamMP4**: Custom MP4 parser for Tesla dashcam container format
- **mp4-muxer**: Client-side MP4 video muxing for video export feature

### UI Framework
- **Radix UI**: Complete set of accessible, unstyled UI primitives
- **shadcn/ui**: Pre-built component implementations using Radix primitives
- **Lucide React**: Icon library

### Development Tools
- **Vite**: Frontend build tool and dev server
- **Replit Plugins**: Runtime error overlay, cartographer, dev banner for Replit environment
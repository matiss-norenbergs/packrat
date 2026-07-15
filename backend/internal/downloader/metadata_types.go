package downloader

// Metadata mirrors the subset of `yt-dlp --dump-single-json` fields Packrat
// cares about. yt-dlp's JSON output has hundreds of fields depending on the
// extractor; only what the Library/Downloads UI displays is mapped here.
//
// When the fetched URL is a playlist (or a video-in-playlist URL), yt-dlp
// nests one flat entry per member under Entries instead of populating the
// single-video fields — see IsPlaylist.
type Metadata struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Uploader    string  `json:"uploader"`
	Duration    float64 `json:"duration"`
	Thumbnail   string  `json:"thumbnail"`
	UploadDate  string  `json:"upload_date"`
	Description string  `json:"description"`
	Ext         string  `json:"ext"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`

	Entries []PlaylistEntry `json:"entries,omitempty"`
}

// PlaylistEntry is one member of a flat-extracted playlist. URL is directly
// re-feedable into yt-dlp as input — that's yt-dlp's own contract for
// --flat-playlist output, so no reconstruction is needed to download it.
type PlaylistEntry struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	URL      string  `json:"url"`
	Duration float64 `json:"duration"`
}

// IsPlaylist reports whether the fetched URL resolved to a playlist (or a
// video-in-playlist URL that yt-dlp expanded) rather than a single video.
func (m *Metadata) IsPlaylist() bool { return len(m.Entries) > 0 }

package downloader

// Metadata mirrors the subset of `yt-dlp --dump-json` fields Packrat cares
// about. yt-dlp's JSON output has hundreds of fields depending on the
// extractor; only what the Library/Downloads UI displays is mapped here.
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
}

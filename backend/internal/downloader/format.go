package downloader

// videoFormatSelectors maps the spec's Video Quality tiers to yt-dlp format
// selectors. Height-capped tiers fall back to progressive "best[height<=N]"
// when no separate video+audio streams fit the cap.
var videoFormatSelectors = map[string]string{
	"best":  "bestvideo*+bestaudio/best",
	"2160p": "bestvideo[height<=2160]+bestaudio/best[height<=2160]",
	"1440p": "bestvideo[height<=1440]+bestaudio/best[height<=1440]",
	"1080p": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
	"720p":  "bestvideo[height<=720]+bestaudio/best[height<=720]",
	"480p":  "bestvideo[height<=480]+bestaudio/best[height<=480]",
	"360p":  "bestvideo[height<=360]+bestaudio/best[height<=360]",
	"worst": "worstvideo*+worstaudio/worst",
}

// BuildFormatSelector returns the yt-dlp `-f` value for a given quality tier.
// Unknown tiers fall back to "best".
func BuildFormatSelector(quality string) string {
	if sel, ok := videoFormatSelectors[quality]; ok {
		return sel
	}
	return videoFormatSelectors["best"]
}

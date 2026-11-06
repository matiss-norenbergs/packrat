package framematch

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"testing"
)

// patternImage returns a deterministic blocky image distinct per seed.
func patternImage(w, h, seed int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	const gx, gy = 8, 6
	state := uint32(seed*2654435761 + 12345)
	next := func() uint32 {
		state = state*1664525 + 1013904223
		return state >> 8
	}
	var cols [gx * gy]color.RGBA
	for i := range cols {
		v := next()
		cols[i] = color.RGBA{R: uint8(v), G: uint8(v >> 8), B: uint8(v >> 16), A: 255}
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := cols[(y*gy/h)*gx+(x*gx/w)]
			// A little gradient so frames aren't perfectly flat blocks.
			c.R = uint8((int(c.R)*3 + x*255/w) / 4)
			img.SetRGBA(x, y, c)
		}
	}
	return img
}

func encodeJPEG(t testing.TB, img image.Image, quality int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// chunkReader returns 1..7 bytes per Read, cycling.
type chunkReader struct {
	data []byte
	n    int
}

func (c *chunkReader) Read(p []byte) (int, error) {
	if len(c.data) == 0 {
		return 0, io.EOF
	}
	c.n = c.n%7 + 1
	k := c.n
	if k > len(p) {
		k = len(p)
	}
	if k > len(c.data) {
		k = len(c.data)
	}
	copy(p, c.data[:k])
	c.data = c.data[k:]
	return k, nil
}

func collect(t *testing.T, r io.Reader) ([][]byte, error) {
	t.Helper()
	sp := newFrameSplitter(r)
	var out [][]byte
	for {
		f, err := sp.Next()
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return out, err
		}
		out = append(out, append([]byte(nil), f...))
	}
}

func TestFrameSplitterSmallReads(t *testing.T) {
	var frames [][]byte
	var stream []byte
	stream = append(stream, 0x00, 0x13, 0xFF, 0x00) // leading garbage incl. a stuffed FF
	for i := 0; i < 4; i++ {
		f := encodeJPEG(t, patternImage(96, 64, i), 90)
		if !bytes.Contains(f, []byte{0xFF, 0x00}) {
			t.Fatalf("frame %d has no 0xFF00 stuffing; test image too tame", i)
		}
		frames = append(frames, f)
		stream = append(stream, f...)
	}
	got, err := collect(t, &chunkReader{data: stream})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(frames) {
		t.Fatalf("got %d frames, want %d", len(got), len(frames))
	}
	for i := range got {
		if !bytes.Equal(got[i], frames[i]) {
			t.Fatalf("frame %d differs", i)
		}
		if _, err := jpeg.Decode(bytes.NewReader(got[i])); err != nil {
			t.Fatalf("frame %d no longer decodes: %v", i, err)
		}
	}
}

func TestFrameSplitterEndsMidFrame(t *testing.T) {
	a := encodeJPEG(t, patternImage(64, 48, 1), 85)
	b := encodeJPEG(t, patternImage(64, 48, 2), 85)
	stream := append(append([]byte(nil), a...), b[:len(b)/2]...)
	got, err := collect(t, &chunkReader{data: stream})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !bytes.Equal(got[0], a) {
		t.Fatalf("want exactly the one complete frame, got %d", len(got))
	}
}

// genReader lazily generates n fake frames (SOI + stuffed payload + EOI) so
// the whole stream never exists in memory, and tracks how many bytes it has
// handed out.
type genReader struct {
	frames, total int
	frameLen      int
	cur           []byte
	emitted       int
}

func (g *genReader) Read(p []byte) (int, error) {
	if len(g.cur) == 0 {
		if g.frames == g.total {
			return 0, io.EOF
		}
		f := make([]byte, 0, g.frameLen)
		f = append(f, 0xFF, 0xD8)
		for len(f) < g.frameLen-2 {
			f = append(f, 0x11, 0xFF, 0x00)
		}
		f = append(f, 0xFF, 0xD9)
		g.cur = f
		g.frames++
	}
	n := copy(p, g.cur)
	g.cur = g.cur[n:]
	g.emitted += n
	return n, nil
}

func TestFrameSplitterBoundedMemory(t *testing.T) {
	const frameLen = 100 << 10
	g := &genReader{total: 500, frameLen: frameLen} // ~50 MB stream
	sp := newFrameSplitter(g)
	returned, consumed := 0, 0
	for {
		f, err := sp.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		returned++
		consumed += len(f)
		// Everything read from the source but not yet part of a returned frame
		// must fit in the splitter's single read buffer.
		if ahead := g.emitted - consumed; ahead > len(sp.r.buf) {
			t.Fatalf("splitter read %d bytes ahead (buffer is %d)", ahead, len(sp.r.buf))
		}
		if cap(sp.buf) > 4*frameLen {
			t.Fatalf("frame buffer grew to %d bytes", cap(sp.buf))
		}
	}
	if returned != g.total {
		t.Fatalf("got %d frames, want %d", returned, g.total)
	}
}

func TestFrameSplitterRejectsRunawayFrame(t *testing.T) {
	r := io.MultiReader(bytes.NewReader([]byte{0xFF, 0xD8}), &zeroReader{n: maxFrameBytes + 10})
	if _, err := newFrameSplitter(r).Next(); err == nil || err == io.EOF {
		t.Fatalf("want size-limit error, got %v", err)
	}
}

type zeroReader struct{ n int }

func (z *zeroReader) Read(p []byte) (int, error) {
	if z.n <= 0 {
		return 0, io.EOF
	}
	k := len(p)
	if k > z.n {
		k = z.n
	}
	for i := 0; i < k; i++ {
		p[i] = 0
	}
	z.n -= k
	return k, nil
}

// Package ldaptest is a tiny in-process LDAP server for tests: simple bind and
// search (and / or / not, equality, presence, substrings) over a fixed set of
// entries. It speaks just enough of RFC 4511 for the portal's LDAP client.
package ldaptest

import (
	"net"
	"strings"
	"sync"
	"testing"

	ber "github.com/go-asn1-ber/asn1-ber"
)

// Entry is one directory object. Password is what a simple bind as DN accepts.
type Entry struct {
	DN       string
	Password string
	Attrs    map[string][]string
}

// Server listens on 127.0.0.1; Port is what an LDAPConfig needs.
type Server struct {
	Port    int
	mu      sync.Mutex
	entries []Entry
	// Binds counts successful simple binds (to tell a lookup from a sign-in).
	Binds int
}

const (
	appBindRequest    = 0
	appBindResponse   = 1
	appUnbindRequest  = 2
	appSearchRequest  = 3
	appSearchEntry    = 4
	appSearchDone     = 5
	resultSuccess     = 0
	resultSizeLimit   = 4
	resultInvalidCred = 49
)

// Start serves entries until the test ends.
func Start(t *testing.T, entries ...Entry) *Server {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{Port: ln.Addr().(*net.TCPAddr).Port, entries: entries}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go s.serve(conn)
		}
	}()
	return s
}

func (s *Server) serve(conn net.Conn) {
	defer conn.Close()
	for {
		packet, err := ber.ReadPacket(conn)
		if err != nil || len(packet.Children) < 2 {
			return
		}
		id := packet.Children[0].Value
		op := packet.Children[1]
		switch op.Tag {
		case appBindRequest:
			code := s.bind(op)
			if _, err := conn.Write(envelope(id, result(appBindResponse, code)).Bytes()); err != nil {
				return
			}
		case appSearchRequest:
			entries, code := s.search(op)
			for _, e := range entries {
				if _, err := conn.Write(envelope(id, entryPacket(e)).Bytes()); err != nil {
					return
				}
			}
			if _, err := conn.Write(envelope(id, result(appSearchDone, code)).Bytes()); err != nil {
				return
			}
		case appUnbindRequest:
			return
		default:
			return
		}
	}
}

func (s *Server) bind(op *ber.Packet) int64 {
	if len(op.Children) < 3 {
		return resultInvalidCred
	}
	dn, _ := op.Children[1].Value.(string)
	password := op.Children[2].Data.String()
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.entries {
		if strings.EqualFold(e.DN, dn) && e.Password != "" && e.Password == password {
			s.Binds++
			return resultSuccess
		}
	}
	return resultInvalidCred
}

func (s *Server) search(op *ber.Packet) ([]Entry, int64) {
	if len(op.Children) < 7 {
		return nil, resultSuccess
	}
	base, _ := op.Children[0].Value.(string)
	sizeLimit, _ := op.Children[3].Value.(int64)
	filter := op.Children[6]
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Entry
	for _, e := range s.entries {
		if !strings.HasSuffix(strings.ToLower(e.DN), strings.ToLower(base)) || !match(filter, e) {
			continue
		}
		if sizeLimit > 0 && int64(len(out)) == sizeLimit {
			return out, resultSizeLimit
		}
		out = append(out, e)
	}
	return out, resultSuccess
}

// match evaluates a search filter (RFC 4511 4.5.1) against an entry.
func match(f *ber.Packet, e Entry) bool {
	values := func(attr string) []string {
		for k, v := range e.Attrs {
			if strings.EqualFold(k, attr) {
				return v
			}
		}
		if strings.EqualFold(attr, "objectClass") {
			return []string{"person", "user"}
		}
		return nil
	}
	switch f.Tag {
	case 0: // and
		for _, c := range f.Children {
			if !match(c, e) {
				return false
			}
		}
		return true
	case 1: // or
		for _, c := range f.Children {
			if match(c, e) {
				return true
			}
		}
		return false
	case 2: // not
		return len(f.Children) == 1 && !match(f.Children[0], e)
	case 3: // equalityMatch
		attr, want := f.Children[0].Data.String(), f.Children[1].Data.String()
		for _, v := range values(attr) {
			if strings.EqualFold(v, want) {
				return true
			}
		}
		return false
	case 4: // substrings
		attr := f.Children[0].Data.String()
		var parts []string
		for _, c := range f.Children[1].Children {
			parts = append(parts, strings.ToLower(c.Data.String()))
		}
		for _, v := range values(attr) {
			lv := strings.ToLower(v)
			ok := true
			for _, p := range parts {
				i := strings.Index(lv, p)
				if i < 0 {
					ok = false
					break
				}
				lv = lv[i+len(p):]
			}
			if ok {
				return true
			}
		}
		return false
	case 7: // present
		return len(values(f.Data.String())) > 0
	}
	return false
}

func envelope(id any, op *ber.Packet) *ber.Packet {
	p := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "LDAP message")
	p.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagInteger, id, "id"))
	p.AppendChild(op)
	return p
}

func result(tag ber.Tag, code int64) *ber.Packet {
	p := ber.Encode(ber.ClassApplication, ber.TypeConstructed, tag, nil, "result")
	p.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagEnumerated, code, "code"))
	p.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "matched"))
	p.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "message"))
	return p
}

func entryPacket(e Entry) *ber.Packet {
	p := ber.Encode(ber.ClassApplication, ber.TypeConstructed, appSearchEntry, nil, "entry")
	p.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, e.DN, "dn"))
	attrs := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "attributes")
	for name, vals := range e.Attrs {
		a := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "attribute")
		a.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, name, "type"))
		set := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSet, nil, "values")
		for _, v := range vals {
			set.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, v, "value"))
		}
		a.AppendChild(set)
		attrs.AppendChild(a)
	}
	p.AppendChild(attrs)
	return p
}

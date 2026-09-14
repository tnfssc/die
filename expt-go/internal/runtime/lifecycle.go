package runtime

import (
	"bytes"
	"encoding/json"
	"syscall"
	"time"
)

const lifecycleMaxBytes int64 = 2 * 1024 * 1024
const lifecycleRecordMax = 16 * 1024

// lifecycle writes the metadata-only ownership sidecar used to reconcile jobs
// after an abrupt owner exit. Commands, prompts and output are deliberately absent.
func (r *Runtime) lifecycle(event string, job Job) {
	if r.cfg.SessionFile == "" {
		return
	}
	record := struct {
		Event       string       `json:"event"`
		At          string       `json:"at"`
		TaskID      string       `json:"taskId"`
		Kind        string       `json:"kind"`
		Status      string       `json:"status"`
		StartedAt   string       `json:"startedAt,omitempty"`
		CompletedAt string       `json:"completedAt,omitempty"`
		Termination *Termination `json:"termination,omitempty"`
		ExitCode    int          `json:"exitCode,omitempty"`
		Signal      string       `json:"signal,omitempty"`
		SessionFile string       `json:"sessionFile,omitempty"`
		CallerID    string       `json:"callerId,omitempty"`
	}{event, time.Now().Format(time.RFC3339Nano), job.ID, job.Kind, job.Status, job.StartedAt, job.CompletedAt, job.Termination, job.ExitCode, job.Signal, job.SessionFile, job.CallerID}
	line, err := json.Marshal(record)
	if err != nil || len(line)+1 > lifecycleRecordMax {
		return
	}
	line = append(line, '\n')
	path := r.cfg.SessionFile + ".jobs.jsonl"
	fd, err := syscall.Open(path, syscall.O_RDWR|syscall.O_CREAT|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return
	}
	defer syscall.Close(fd)
	if syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return
	}
	defer syscall.Flock(fd, syscall.LOCK_UN)
	var st syscall.Stat_t
	if syscall.Fstat(fd, &st) != nil || st.Mode&syscall.S_IFMT != syscall.S_IFREG || st.Nlink != 1 || st.Mode&0077 != 0 {
		return
	}
	size := st.Size
	if size+int64(len(line)) > lifecycleMaxBytes {
		keep := lifecycleMaxBytes / 2
		if keep > size {
			keep = size
		}
		tail := make([]byte, keep)
		n, _ := syscall.Pread(fd, tail, size-keep)
		tail = tail[:n]
		if i := bytes.IndexByte(tail, '\n'); i >= 0 {
			tail = tail[i+1:]
		} else {
			tail = nil
		}
		if syscall.Ftruncate(fd, 0) != nil {
			return
		}
		if len(tail) > 0 {
			if _, err = syscall.Pwrite(fd, tail, 0); err != nil {
				return
			}
		}
		size = int64(len(tail))
	}
	if _, err = syscall.Pwrite(fd, line, size); err == nil {
		_ = syscall.Fsync(fd)
	}
}

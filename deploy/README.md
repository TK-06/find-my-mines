# EC2 automatic deployment (v3.11)

GitHub Actions tests pushes and pull requests to `main`. The EC2 timer checks the
public `main` SHA once a minute, then asks GitHub for the **CI** push workflow
result for that exact commit. It builds a candidate release only after CI succeeds.
The app and Cloudflare Tunnel need no inbound deployment port or GitHub secret.

The release layout is:

```text
/home/ubuntu/fmm/
  current -> releases/<sha>
  releases/<sha>/
  shared/.env
  shared/deploy-status.json
```

The systemd service starts from `current`, so each release links `.env` to the
same `shared/.env`. The timer uses `flock` to avoid overlapping runs. On a failed
restart or health check, it switches `current` back and restarts the previous
release. It retains the three newest releases, protecting the current and
previous ones. A failed CI SHA is remembered and rechecked after 15 minutes,
so a successful CI rerun can still deploy it. A pending CI check is retried
with a delay. Journal logs and `/admin` show deploy results.

## Before the first automatic deployment

The repository owner runs the Git commands and pushes v3.11 to `main`. Wait for
the new **CI** workflow to pass on that commit. Keep `~/find-my-mines` in place
through the transition.

From the owner's PC, `ssh fmm` reaches the instance through AWS Systems Manager.
On the server, the owner creates the first release from the tested main commit:

```bash
install -d -m 700 ~/fmm/releases ~/fmm/shared
git clone --depth 1 --branch main https://github.com/TK-06/find-my-mines.git ~/fmm/releases/first
cd ~/fmm/releases/first
sha=$(git rev-parse HEAD)
cd ~/fmm/releases
mv first "$sha"
cd "$sha"
npm ci
```

Before the cutover, confirm the SHA is the green CI SHA and copy any required
`VITE_*` build settings from the existing `.env`. Copy the existing secret file
into shared storage, preserving its restrictive permissions, and link it into
the release:

```bash
cp -p ~/find-my-mines/.env ~/fmm/shared/.env
chmod 600 ~/fmm/shared/.env
ln -s ~/fmm/shared/.env ~/fmm/releases/"$sha"/.env
cd ~/fmm/releases/"$sha"
npm run build
ln -s ~/fmm/releases/"$sha" ~/fmm/current
```

Keep the old checkout and its `.env` until the new service is verified, so a
manual rollback still has its configuration. Remove that old copy only when
the owner retires the old checkout. Existing live games end on the service
restart.

Install the tracked unit files. The override changes only the app working
directory and status path; it preserves the existing `ExecStart` and restart
settings. Validate the narrow sudoers rule before using it:

```bash
sudo mkdir -p /etc/systemd/system/findmymines.service.d
sudo cp ~/fmm/current/deploy/findmymines.override.conf /etc/systemd/system/findmymines.service.d/override.conf
sudo cp ~/fmm/current/deploy/findmymines-deploy.service /etc/systemd/system/
sudo cp ~/fmm/current/deploy/findmymines-deploy.timer /etc/systemd/system/
sudo install -m 440 ~/fmm/current/deploy/findmymines-deploy.sudoers /etc/sudoers.d/findmymines-deploy
sudo visudo -cf /etc/sudoers.d/findmymines-deploy
sudo systemctl daemon-reload
sudo systemctl restart findmymines
curl -fsS http://127.0.0.1:3000/health
bash ~/fmm/current/deploy/auto-deploy.sh --dry-run
sudo systemctl enable --now findmymines-deploy.timer
systemctl list-timers findmymines-deploy.timer
```

The dry run performs read-only Git and GitHub API checks and prints the release
it would deploy. It does not install, switch, restart, or write status. Use
`journalctl -u findmymines-deploy.service -n 100 --no-pager` for timer results.
To stop automatic deployment, run `sudo systemctl disable --now
findmymines-deploy.timer`. To roll back manually, point `~/fmm/current` to an
older verified release and restart `findmymines`. The deploy script's automatic
rollback handles a failed health check during an ordinary timer run.

## End-to-end check

The owner pushes a harmless commit to `main`. Confirm GitHub Actions **CI**
succeeds for that SHA. Within about two minutes, `readlink -f ~/fmm/current`
should name that SHA; `/health` should be healthy; `/admin` should show its
commit and last deploy status. Confirm an active player session works, then
retain the previous release and old `~/find-my-mines` checkout until the owner
is satisfied.

Session Manager SSH works from networks outside the old allowlisted IPs. After
checking it on a different network, the owner can remove the direct personal
SSH CIDR rules from the EC2 security group. Keep the EC2 Instance Connect
prefix-list SSH rule for browser access.

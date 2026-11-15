use rage_formats::{parse_yft, parse_ytd};
use std::env;
use std::fs;

#[test]
fn parse_real_yft_when_fixture_path_is_provided() {
    let path = match env::var("GTAV_AUTOPORT_YFT") {
        Ok(path) => path,
        Err(_) => {
            eprintln!("Skipping real YFT fixture parse; set GTAV_AUTOPORT_YFT to a local YFT path.");
            return;
        }
    };
    let bytes = fs::read(&path).expect("could not read GTAV_AUTOPORT_YFT fixture");
    let fragment = parse_yft(&bytes).expect("rage-formats failed to parse the supplied YFT fixture");
    assert!(
        fragment.drawable.is_some() || !fragment.extra_drawables.is_empty(),
        "parsed YFT has no main or extra drawable"
    );
}

#[test]
fn parse_real_ytd_when_fixture_path_is_provided() {
    let path = match env::var("GTAV_AUTOPORT_YTD") {
        Ok(path) => path,
        Err(_) => {
            eprintln!("Skipping real YTD fixture parse; set GTAV_AUTOPORT_YTD to a local YTD path.");
            return;
        }
    };
    let bytes = fs::read(&path).expect("could not read GTAV_AUTOPORT_YTD fixture");
    let textures = parse_ytd(&bytes).expect("rage-formats failed to parse the supplied YTD fixture");
    assert!(!textures.is_empty(), "parsed YTD contains no textures");
}

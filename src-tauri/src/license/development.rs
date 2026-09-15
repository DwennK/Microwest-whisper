//! Opt-in development access. Release builds always require a real licence.
pub(crate) fn enabled_for(value: Option<&str>) -> bool {
    cfg!(debug_assertions) && value == Some("1")
}

pub(crate) fn enabled() -> bool {
    enabled_for(std::env::var("MICROWEST_LICENSE_BYPASS").ok().as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bypass_requires_an_explicit_flag_and_a_debug_build() {
        assert!(!enabled_for(None));
        assert!(!enabled_for(Some("0")));
        assert!(!enabled_for(Some("true")));
        assert_eq!(enabled_for(Some("1")), cfg!(debug_assertions));
    }

    #[test]
    fn release_build_ignores_the_environment_flag() {
        if !cfg!(debug_assertions) {
            std::env::set_var("MICROWEST_LICENSE_BYPASS", "1");
            assert!(!enabled());
            std::env::remove_var("MICROWEST_LICENSE_BYPASS");
        }
    }
}
